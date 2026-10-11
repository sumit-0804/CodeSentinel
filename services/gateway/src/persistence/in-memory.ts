import type { AgentKind } from "@code-sentinel/contracts";

import { resolveEffectiveConfig, type RepositorySettingsInput } from "./effective-config.js";
import type {
  ApiKeyRecord,
  ApiKeyStore,
  RepositoryConfigStore,
  RepositoryRecord,
  RepositoryStore,
  SessionRecord,
  SessionStore,
  Stores,
  UserRecord,
  UserStore,
} from "./stores.js";

export interface StoreSeed {
  organizations: { organizationId: string; defaultConfidenceThreshold?: number }[];
  repositories: RepositoryRecord[];
  repositorySettings: ({ repositoryId: string } & RepositorySettingsInput)[];
  /** Only rows that exist; an agent without a row is enabled (the column default). */
  repositoryAgentConfig: { repositoryId: string; agent: AgentKind; enabled: boolean }[];
  sessions: SessionRecord[];
  apiKeys: ApiKeyRecord[];
  users: UserRecord[];
}

export const emptySeed = (): StoreSeed => ({
  organizations: [],
  repositories: [],
  repositorySettings: [],
  repositoryAgentConfig: [],
  sessions: [],
  apiKeys: [],
  users: [],
});

/**
 * All five stores over plain arrays, for tests and `GATEWAY_SEED=dev`. Records are copied on the
 * way in and out, so callers cannot mutate the stored rows.
 */
export class InMemoryStores implements Stores {
  readonly repositories: RepositoryStore;
  readonly repositoryConfig: RepositoryConfigStore;
  readonly sessions: SessionStore;
  readonly apiKeys: ApiKeyStore;
  readonly users: UserStore;

  constructor(seed: StoreSeed = emptySeed()) {
    const data: StoreSeed = structuredClone(seed);

    this.repositories = {
      findByGithubRepoId: async (githubRepoId) => copy(data.repositories.find((r) => r.githubRepoId === githubRepoId)),
    };

    this.repositoryConfig = {
      getEffectiveConfig: async (repositoryId) => {
        const repository = data.repositories.find((r) => r.repositoryId === repositoryId);
        if (!repository) return undefined;
        const settings = data.repositorySettings.find((s) => s.repositoryId === repositoryId);
        const organization = data.organizations.find((o) => o.organizationId === repository.organizationId);
        const disabledAgents = new Set<AgentKind>(
          data.repositoryAgentConfig.filter((row) => row.repositoryId === repositoryId && !row.enabled).map((row) => row.agent),
        );

        return resolveEffectiveConfig({
          ...(settings ? { settings } : {}),
          ...(organization?.defaultConfidenceThreshold !== undefined
            ? { organizationThreshold: organization.defaultConfidenceThreshold }
            : {}),
          disabledAgents,
        });
      },
    };

    this.sessions = {
      findActiveByTokenHash: async (tokenHash, now) =>
        copy(
          data.sessions.find(
            (s) => s.tokenHash === tokenHash && s.revokedAt === undefined && s.expiresAt.getTime() > now.getTime(),
          ),
        ),
    };

    this.apiKeys = {
      findActiveByKeyHash: async (keyHash) =>
        copy(data.apiKeys.find((k) => k.keyHash === keyHash && k.revokedAt === undefined)),
      touchLastUsed: async (keyId, now) => {
        const key = data.apiKeys.find((k) => k.keyId === keyId);
        if (key) key.lastUsedAt = new Date(now);
      },
    };

    this.users = {
      findById: async (userId) => copy(data.users.find((u) => u.userId === userId)),
    };
  }
}

function copy<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
