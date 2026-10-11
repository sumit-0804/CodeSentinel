import type { AgentKind } from "@code-sentinel/contracts";
import type { PrismaClient } from "@code-sentinel/db";

import { resolveEffectiveConfig } from "./effective-config.js";
import type { ApiKeyStore, RepositoryConfigStore, RepositoryStore, SessionStore, Stores, UserStore } from "./stores.js";

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

  constructor(prisma: PrismaClient) {
    this.repositories = {
      findByGithubRepoId: async (githubRepoId) => {
        const row = await prisma.repository.findUnique({ where: { githubRepoId: BigInt(githubRepoId) } });
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
          if ((error as { code?: unknown }).code !== "P2002") throw error;
          await write(false);
        }
      },
    };
  }
}
