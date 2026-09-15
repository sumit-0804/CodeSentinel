import { AgentKindSchema, type AgentKind } from "@code-sentinel/contracts";

import type {
  ApiKeyRecord,
  ApiKeyStore,
  EffectiveRepositoryConfig,
  RepositoryConfigStore,
  RepositoryRecord,
  RepositoryStore,
  SessionRecord,
  SessionStore,
  Stores,
  UserRecord,
  UserStore,
} from "./stores.js";

/** Platform default threshold when neither the repository nor the organization sets one (FR-ORC-06). */
export const PLATFORM_DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

/** Column defaults from `repository_settings` in `schema.sql`. */
const SETTINGS_DEFAULTS = { agentTimeoutMs: 20000, autoFixStyle: true, postInlineComments: true };

export interface StoreSeed {
  organizations: { organizationId: string; defaultConfidenceThreshold?: number }[];
  repositories: RepositoryRecord[];
  repositorySettings: {
    repositoryId: string;
    /** `null` or absent means inherit. */
    confidenceThresholdOverride?: number | null;
    agentTimeoutMs?: number;
    autoFixStyle?: boolean;
    postInlineComments?: boolean;
  }[];
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
        const disabled = new Set(
          data.repositoryAgentConfig.filter((row) => row.repositoryId === repositoryId && !row.enabled).map((row) => row.agent),
        );

        const threshold: Pick<EffectiveRepositoryConfig, "confidenceThreshold" | "thresholdSource"> =
          settings?.confidenceThresholdOverride != null
            ? { confidenceThreshold: settings.confidenceThresholdOverride, thresholdSource: "repository_override" }
            : organization?.defaultConfidenceThreshold !== undefined
              ? { confidenceThreshold: organization.defaultConfidenceThreshold, thresholdSource: "organization_default" }
              : { confidenceThreshold: PLATFORM_DEFAULT_CONFIDENCE_THRESHOLD, thresholdSource: "platform_default" };

        return {
          enabledAgents: AgentKindSchema.options.filter((agent) => !disabled.has(agent)),
          ...threshold,
          agentTimeoutMs: settings?.agentTimeoutMs ?? SETTINGS_DEFAULTS.agentTimeoutMs,
          autoFixStyle: settings?.autoFixStyle ?? SETTINGS_DEFAULTS.autoFixStyle,
          postInlineComments: settings?.postInlineComments ?? SETTINGS_DEFAULTS.postInlineComments,
        };
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
