import type { AgentKind, OrganizationMembership, ThresholdSource } from "@code-sentinel/contracts";

/**
 * What the gateway reads from PostgreSQL, as interfaces shaped by `docs/design/schema/schema.sql`.
 * `InMemoryStores` implements them until the PostgreSQL stores land.
 */

/** A `repositories` row. */
export interface RepositoryRecord {
  repositoryId: string;
  organizationId: string;
  /** `github_installations.id`, the internal row id, not GitHub's numeric installation id. */
  githubInstallationId: string;
  githubRepoId: number;
  fullName: string;
  reviewEnabled: boolean;
}

/** Repository settings resolved against the organization and platform defaults (UC-4). */
export interface EffectiveRepositoryConfig {
  /** In `AgentKindSchema` order. */
  enabledAgents: AgentKind[];
  confidenceThreshold: number;
  thresholdSource: ThresholdSource;
  agentTimeoutMs: number;
  autoFixStyle: boolean;
  postInlineComments: boolean;
}

/** An `api_keys` row. `keyHash` is the SHA-256 of the full `cs_live_` key; the key itself is never stored. */
export interface ApiKeyRecord {
  keyId: string;
  userId: string;
  organizationId: string;
  label: string;
  keyPrefix: string;
  keyHash: string;
  revokedAt?: Date;
  lastUsedAt?: Date;
}

/** A `users` row with its `organization_members` rows. */
export interface UserRecord {
  userId: string;
  /** Absent until the user links GitHub. */
  githubLogin?: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  memberships: OrganizationMembership[];
}

/** Profile fields from a verified Supabase token, written to `users` when the user signs in. */
export interface SignInProfile {
  userId: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

export interface RepositoryStore {
  findByGithubRepoId(githubRepoId: number): Promise<RepositoryRecord | undefined>;
}

export interface RepositoryConfigStore {
  /** `undefined` when the repository does not exist. */
  getEffectiveConfig(repositoryId: string): Promise<EffectiveRepositoryConfig | undefined>;
}

/** Supabase owns sessions; the gateway only asks whether one is still live, so sign-out applies before `exp`. */
export interface SessionStore {
  isActive(sessionId: string): Promise<boolean>;
}

export interface ApiKeyStore {
  /** Only keys that are not revoked. */
  findActiveByKeyHash(keyHash: string): Promise<ApiKeyRecord | undefined>;
  touchLastUsed(keyId: string, now: Date): Promise<void>;
}

export interface UserStore {
  findById(userId: string): Promise<UserRecord | undefined>;
  /** Inserts or refreshes the `users` row (replaces Supabase's auth trigger); memberships are untouched. */
  recordSignIn(profile: SignInProfile, now: Date): Promise<void>;
}

export interface Stores {
  repositories: RepositoryStore;
  repositoryConfig: RepositoryConfigStore;
  sessions: SessionStore;
  apiKeys: ApiKeyStore;
  users: UserStore;
}
