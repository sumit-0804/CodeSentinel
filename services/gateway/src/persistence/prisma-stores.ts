import type { AgentKind } from "@code-sentinel/contracts";
import type { Prisma, PrismaClient } from "@code-sentinel/db";

import { resolveEffectiveConfig } from "./effective-config.js";
import {
  GithubAccountTakenError,
  type ApiKeyStore,
  type GithubTokenStore,
  type InstallationStore,
  type RepositoryConfigStore,
  type RepositoryStore,
  type SessionStore,
  type Stores,
  type SyncedRepository,
  type UserStore,
} from "./stores.js";

const isUniqueViolation = (error: unknown) => (error as { code?: unknown }).code === "P2002";

/** Upserts one repository by GitHub id into an installation; a stale active row holding the same name is marked removed first. */
async function upsertRepository(
  tx: Prisma.TransactionClient,
  installation: { id: string; organizationId: string },
  repo: SyncedRepository,
  now: Date,
): Promise<void> {
  const githubRepoId = BigInt(repo.githubRepoId);
  await tx.repository.updateMany({
    where: { organizationId: installation.organizationId, fullName: repo.fullName, removedAt: null, NOT: { githubRepoId } },
    data: { removedAt: now },
  });
  const fields = {
    organizationId: installation.organizationId,
    githubInstallationId: installation.id,
    fullName: repo.fullName,
    defaultBranch: repo.defaultBranch,
    isPrivate: repo.isPrivate,
    primaryLanguage: repo.primaryLanguage ?? null,
  };
  await tx.repository.upsert({ where: { githubRepoId }, create: { githubRepoId, ...fields }, update: { ...fields, removedAt: null } });
}

/**
 * All stores over Supabase Postgres through Prisma. GitHub ids are `bigint` columns but stay below
 * 2^53, so they are safe as numbers; `key_hash` is `bytea` and the stores speak hex.
 */
export class PrismaStores implements Stores {
  readonly repositories: RepositoryStore;
  readonly repositoryConfig: RepositoryConfigStore;
  readonly sessions: SessionStore;
  readonly apiKeys: ApiKeyStore;
  readonly users: UserStore;
  readonly installations: InstallationStore;
  readonly githubTokens: GithubTokenStore;

  constructor(prisma: PrismaClient) {
    this.repositories = {
      findByGithubRepoId: async (githubRepoId) => {
        const row = await prisma.repository.findFirst({
          where: {
            githubRepoId: BigInt(githubRepoId),
            removedAt: null,
            installation: { uninstalledAt: null, suspendedAt: null },
          },
        });
        if (!row) return undefined;
        return {
          repositoryId: row.id,
          organizationId: row.organizationId,
          githubInstallationId: row.githubInstallationId,
          githubRepoId: Number(row.githubRepoId),
          fullName: row.fullName,
          reviewEnabled: row.reviewEnabled,
        };
      },
      listForOrganization: async (organizationId) => {
        const rows = await prisma.repository.findMany({
          where: { organizationId, removedAt: null, installation: { uninstalledAt: null } },
          orderBy: { fullName: "asc" },
        });
        return rows.map((row) => ({
          repositoryId: row.id,
          fullName: row.fullName,
          defaultBranch: row.defaultBranch,
          isPrivate: row.isPrivate,
          ...(row.primaryLanguage !== null ? { primaryLanguage: row.primaryLanguage } : {}),
          reviewEnabled: row.reviewEnabled,
        }));
      },
    };

    this.repositoryConfig = {
      getEffectiveConfig: async (repositoryId) => {
        const row = await prisma.repository.findUnique({
          where: { id: repositoryId },
          select: {
            settings: true,
            agentConfig: { where: { enabled: false }, select: { agent: true } },
            organization: { select: { defaultConfidenceThreshold: true } },
          },
        });
        if (!row) return undefined;
        const { settings } = row;
        return resolveEffectiveConfig({
          ...(settings
            ? {
                settings: {
                  confidenceThresholdOverride: settings.confidenceThresholdOverride?.toNumber() ?? null,
                  agentTimeoutMs: settings.agentTimeoutMs,
                  autoFixStyle: settings.autoFixStyle,
                  postInlineComments: settings.postInlineComments,
                },
              }
            : {}),
          organizationThreshold: row.organization.defaultConfidenceThreshold.toNumber(),
          disabledAgents: new Set<AgentKind>(row.agentConfig.map((config) => config.agent)),
        });
      },
    };

    // `auth.sessions` is Supabase's; `private.session_is_active` is a security-definer function only `prisma` may run.
    this.sessions = {
      isActive: async (sessionId) => {
        const rows = await prisma.$queryRaw<{ active: boolean }[]>`select private.session_is_active(${sessionId}::uuid) as active`;
        return rows[0]?.active === true;
      },
    };

    this.apiKeys = {
      findActiveByKeyHash: async (keyHash) => {
        const row = await prisma.apiKey.findUnique({ where: { keyHash: Buffer.from(keyHash, "hex") } });
        if (!row || row.revokedAt !== null) return undefined;
        return {
          keyId: row.id,
          userId: row.userId,
          organizationId: row.organizationId,
          label: row.label,
          keyPrefix: row.keyPrefix,
          keyHash: Buffer.from(row.keyHash).toString("hex"),
          ...(row.lastUsedAt ? { lastUsedAt: row.lastUsedAt } : {}),
        };
      },
      // `updateMany`, so a key deleted between lookup and touch is not an error.
      touchLastUsed: async (keyId, now) => {
        await prisma.apiKey.updateMany({ where: { id: keyId }, data: { lastUsedAt: now } });
      },
    };

    this.users = {
      findById: async (userId) => {
        const row = await prisma.user.findUnique({
          where: { id: userId },
          include: {
            memberships: { orderBy: { addedAt: "asc" }, include: { organization: { select: { displayName: true } } } },
          },
        });
        if (!row) return undefined;
        return {
          userId: row.id,
          ...(row.githubUserId !== null ? { githubUserId: Number(row.githubUserId) } : {}),
          ...(row.githubLogin !== null ? { githubLogin: row.githubLogin } : {}),
          ...(row.email !== null ? { email: row.email } : {}),
          ...(row.name !== null ? { name: row.name } : {}),
          ...(row.avatarUrl !== null ? { avatarUrl: row.avatarUrl } : {}),
          memberships: row.memberships.map((m) => ({
            organizationId: m.organizationId,
            displayName: m.organization.displayName,
            role: m.role,
          })),
        };
      },
      recordSignIn: async ({ userId, email, name, avatarUrl }, now) => {
        const write = (withEmail: boolean) => {
          const fields = {
            ...(withEmail && email !== undefined ? { email } : {}),
            ...(name !== undefined ? { name } : {}),
            ...(avatarUrl !== undefined ? { avatarUrl } : {}),
            lastSeenAt: now,
          };
          return prisma.user.upsert({ where: { id: userId }, create: { id: userId, ...fields }, update: fields });
        };
        try {
          await write(true);
        } catch (error) {
          // `users.email` is unique; if another row holds the address (seed or dev data), keep signing in without it.
          if (!isUniqueViolation(error)) throw error;
          await write(false);
        }
      },
      linkGithub: async (userId, { githubUserId, login }) => {
        try {
          await prisma.user.updateMany({ where: { id: userId }, data: { githubUserId: BigInt(githubUserId), githubLogin: login } });
        } catch (error) {
          // `users.github_user_id` is unique: one GitHub account belongs to one Code Sentinel user.
          if (isUniqueViolation(error)) throw new GithubAccountTakenError();
          throw error;
        }
      },
      setMembership: async (organizationId, userId, role) => {
        await prisma.organizationMember.upsert({
          where: { organizationId_userId: { organizationId, userId } },
          create: { organizationId, userId, role: role ?? "member" },
          update: role !== undefined ? { role } : {},
        });
      },
    };

    this.installations = {
      upsert: async ({ githubInstallationId, account, suspendedAt }) =>
        prisma.$transaction(async (tx) => {
          const githubOrgId = BigInt(account.githubId);
          // Logins can be reused after a rename; move a stale holder of this login out of the way of the unique column.
          await tx.organization.updateMany({
            where: { githubOrgLogin: account.login, NOT: { githubOrgId } },
            data: { githubOrgLogin: `${account.login}~${githubOrgId}` },
          });
          const fields = { githubOrgLogin: account.login, accountType: account.type, displayName: account.login };
          const org = await tx.organization.upsert({ where: { githubOrgId }, create: { githubOrgId, ...fields }, update: fields });
          const installationFields = { organizationId: org.id, accountLogin: account.login, suspendedAt: suspendedAt ?? null };
          const installation = await tx.githubInstallation.upsert({
            where: { githubInstallationId: BigInt(githubInstallationId) },
            create: { githubInstallationId: BigInt(githubInstallationId), ...installationFields },
            update: { ...installationFields, uninstalledAt: null },
          });
          return { organizationId: org.id, installationId: installation.id };
        }),
      setSuspended: async (githubInstallationId, at) => {
        await prisma.githubInstallation.updateMany({ where: { githubInstallationId: BigInt(githubInstallationId) }, data: { suspendedAt: at } });
      },
      markUninstalled: async (githubInstallationId, at) => {
        await prisma.$transaction(async (tx) => {
          const installation = await tx.githubInstallation.findUnique({ where: { githubInstallationId: BigInt(githubInstallationId) } });
          if (!installation) return;
          await tx.githubInstallation.update({ where: { id: installation.id }, data: { uninstalledAt: at } });
          await tx.repository.updateMany({ where: { githubInstallationId: installation.id, removedAt: null }, data: { removedAt: at } });
        });
      },
      syncRepositories: async (githubInstallationId, repos, now) => {
        await prisma.$transaction(async (tx) => {
          const installation = await tx.githubInstallation.findUnique({ where: { githubInstallationId: BigInt(githubInstallationId) } });
          if (!installation) return;
          for (const repo of repos) await upsertRepository(tx, installation, repo, now);
          await tx.repository.updateMany({
            where: { githubInstallationId: installation.id, removedAt: null, githubRepoId: { notIn: repos.map((r) => BigInt(r.githubRepoId)) } },
            data: { removedAt: now },
          });
        });
      },
      addRepositories: async (githubInstallationId, repos, now) => {
        await prisma.$transaction(async (tx) => {
          const installation = await tx.githubInstallation.findUnique({ where: { githubInstallationId: BigInt(githubInstallationId) } });
          if (!installation) return;
          for (const repo of repos) await upsertRepository(tx, installation, repo, now);
        });
      },
      removeRepositories: async (githubInstallationId, githubRepoIds, at) => {
        await prisma.repository.updateMany({
          where: {
            installation: { githubInstallationId: BigInt(githubInstallationId) },
            githubRepoId: { in: githubRepoIds.map(BigInt) },
            removedAt: null,
          },
          data: { removedAt: at },
        });
      },
      listForUser: async (userId) => {
        const rows = await prisma.githubInstallation.findMany({
          where: { uninstalledAt: null, organization: { members: { some: { userId } } } },
          include: {
            organization: { select: { accountType: true } },
            _count: { select: { repositories: { where: { removedAt: null } } } },
          },
          orderBy: { accountLogin: "asc" },
        });
        return rows.map((row) => ({
          installationId: row.id,
          organizationId: row.organizationId,
          githubInstallationId: Number(row.githubInstallationId),
          accountLogin: row.accountLogin,
          accountType: row.organization.accountType,
          suspended: row.suspendedAt !== null,
          repositoryCount: row._count.repositories,
        }));
      },
    };

    this.githubTokens = {
      get: async (userId) => {
        const row = await prisma.githubUserToken.findUnique({ where: { userId } });
        if (!row) return undefined;
        return {
          accessTokenSealed: row.accessTokenSealed,
          ...(row.refreshTokenSealed !== null ? { refreshTokenSealed: row.refreshTokenSealed } : {}),
          ...(row.expiresAt !== null ? { expiresAt: row.expiresAt } : {}),
          ...(row.refreshExpiresAt !== null ? { refreshExpiresAt: row.refreshExpiresAt } : {}),
        };
      },
      put: async (userId, tokens) => {
        const fields = {
          accessTokenSealed: tokens.accessTokenSealed,
          refreshTokenSealed: tokens.refreshTokenSealed ?? null,
          expiresAt: tokens.expiresAt ?? null,
          refreshExpiresAt: tokens.refreshExpiresAt ?? null,
        };
        await prisma.githubUserToken.upsert({ where: { userId }, create: { userId, ...fields }, update: fields });
      },
    };
  }
}
