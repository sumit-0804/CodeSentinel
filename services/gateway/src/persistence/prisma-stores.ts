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

    // Supabase owns sessions and there is no `sessions` table, so no `cs_session` cookie is valid here (A5 removes the path).
    this.sessions = { findActiveByTokenHash: async () => undefined };

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
          ...(row.avatarUrl !== null ? { avatarUrl: row.avatarUrl } : {}),
          memberships: row.memberships.map((m) => ({
            organizationId: m.organizationId,
            displayName: m.organization.displayName,
            role: m.role,
          })),
        };
      },
    };
  }
}
