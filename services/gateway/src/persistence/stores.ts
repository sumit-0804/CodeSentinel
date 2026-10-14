import type {
  AgentKind,
  AgentMode,
  CheckConclusion,
  CombinedReport,
  OrganizationMembership,
  RepositoryConfigUpdate,
  ReviewDefaultsUpdate,
  ReviewStatus,
  ReviewTrigger,
  ThresholdSource,
} from "@code-sentinel/contracts";

import type { OrganizationDefaultsInput, RepositoryConfigInputs } from "./effective-config.js";

/**
 * What the gateway reads and writes in PostgreSQL, as interfaces shaped by `docs/design/schema/schema.sql`.
 * `PrismaStores` implements them over Supabase; `InMemoryStores` for tests and the dev seed.
 */

/** A `repositories` row. */
export interface RepositoryRecord {
  repositoryId: string;
  organizationId: string;
  /** `github_installations.id`, the internal row id, not GitHub's numeric installation id. */
  githubInstallationId: string;
  /** GitHub's numeric installation id, for calls made outside a webhook; absent when the installation isn't known. */
  githubInstallationNumber?: number;
  githubRepoId: number;
  fullName: string;
  reviewEnabled: boolean;
}

/** Repository settings resolved against the organization and platform defaults (UC-4). */
export interface EffectiveRepositoryConfig {
  agentModes: Record<AgentKind, AgentMode>;
  /** Agents whose mode isn't `off`, in `AgentKindSchema` order. */
  enabledAgents: AgentKind[];
  /** Agents in `block` mode: only their critical findings fail the Check Run. */
  blockingAgents: AgentKind[];
  /** Base-branch patterns a pull request must merge into to be reviewed; never empty. */
  reviewBranches: string[];
  confidenceThreshold: number;
  thresholdSource: ThresholdSource;
  agentTimeoutMs: number;
  autoFixStyle: boolean;
  postInlineComments: boolean;
}

/** A repository as the dashboard lists it. */
export interface RepositorySummary {
  repositoryId: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  primaryLanguage?: string;
  reviewEnabled: boolean;
}

/** A GitHub account (a personal user or an organization) that installed the App; stored as an `organizations` row. */
export interface InstallationAccount {
  githubId: number;
  login: string;
  type: "user" | "organization";
}

/** A repository an installation covers, as GitHub reports it. */
export interface SyncedRepository {
  githubRepoId: number;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  primaryLanguage?: string;
}

/** An installation as a member of its organization sees it. */
export interface InstallationSummary {
  installationId: string;
  organizationId: string;
  githubInstallationId: number;
  accountLogin: string;
  accountType: "user" | "organization";
  suspended: boolean;
  repositoryCount: number;
}

/** A `github_user_tokens` row. Both tokens are sealed with `SecretBox`; the store never sees plaintext. */
export interface SealedGithubTokens {
  accessTokenSealed: string;
  refreshTokenSealed?: string;
  expiresAt?: Date;
  refreshExpiresAt?: Date;
}

/** Thrown by `linkGithub` when the GitHub account already belongs to another Code Sentinel user. */
export class GithubAccountTakenError extends Error {
  constructor() {
    super("This GitHub account is linked to another user");
    this.name = "GithubAccountTakenError";
  }
}

/** A `users` row with its `organization_members` rows. */
export interface UserRecord {
  userId: string;
  /** Absent until the user links GitHub. */
  githubUserId?: number;
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
  /** Skips removed repositories and those whose installation is uninstalled or suspended: their PRs are not reviewed. */
  findByGithubRepoId(githubRepoId: number): Promise<RepositoryRecord | undefined>;
  /** The same live repository by id, only if it belongs to the organization (NFR-13). */
  findForOrganization(organizationId: string, repositoryId: string): Promise<RepositoryRecord | undefined>;
  /** The organization's active repositories, by name. */
  listForOrganization(organizationId: string): Promise<RepositorySummary[]>;
}

export interface InstallationStore {
  /** Upserts the account's `organizations` row (by GitHub id) and the installation; a re-install clears `uninstalled_at`. */
  upsert(input: { githubInstallationId: number; account: InstallationAccount; suspendedAt?: Date }): Promise<{ organizationId: string; installationId: string }>;
  setSuspended(githubInstallationId: number, at: Date | null): Promise<void>;
  /** Marks the installation uninstalled and all its repositories removed; nothing is deleted. */
  markUninstalled(githubInstallationId: number, at: Date): Promise<void>;
  /** Makes `repos` exactly the installation's active repositories: upserts them by GitHub id, marks the rest removed. */
  syncRepositories(githubInstallationId: number, repos: SyncedRepository[], now: Date): Promise<void>;
  addRepositories(githubInstallationId: number, repos: SyncedRepository[], now: Date): Promise<void>;
  removeRepositories(githubInstallationId: number, githubRepoIds: number[], at: Date): Promise<void>;
  /** Active installations of every organization the user belongs to. */
  listForUser(userId: string): Promise<InstallationSummary[]>;
}

export interface GithubTokenStore {
  get(userId: string): Promise<SealedGithubTokens | undefined>;
  put(userId: string, tokens: SealedGithubTokens): Promise<void>;
}

export interface RepositoryConfigStore {
  /** `undefined` when the repository does not exist. */
  getEffectiveConfig(repositoryId: string): Promise<EffectiveRepositoryConfig | undefined>;
  /** `undefined` when the repository does not exist or was removed. */
  getConfigInputs(repositoryId: string): Promise<RepositoryConfigInputs | undefined>;
  /** Applies a partial update in one transaction; `updatedBy` is recorded on every row written. */
  updateConfig(repositoryId: string, update: RepositoryConfigUpdate, updatedBy: string): Promise<void>;
  /** `undefined` when the organization does not exist. */
  getReviewDefaults(organizationId: string): Promise<OrganizationDefaultsInput | undefined>;
  updateReviewDefaults(organizationId: string, update: ReviewDefaultsUpdate, updatedBy: string): Promise<void>;
}

/** A `reviews` row, written by the orchestrator, as the history API reads it. */
export interface ReviewRecord {
  reviewId: string;
  organizationId: string;
  repositoryId: string;
  repositoryFullName: string;
  trigger: ReviewTrigger;
  prNumber?: number;
  prTitle?: string;
  headSha: string;
  headRef?: string;
  baseRef?: string;
  /** `cancelled` only a job can reach; the API reports it as `failed`. */
  status: ReviewStatus | "cancelled";
  checkConclusion?: CheckConclusion;
  confidenceThreshold: number;
  durationMs?: number;
  createdAt: Date;
  /** Absent while the review runs, or when the stored report doesn't parse. */
  report?: CombinedReport;
}

export interface ReviewListFilter {
  repositoryId?: string;
  status?: ReviewStatus[];
  /** Each pull request's newest review only. */
  latest: boolean;
  limit: number;
  offset: number;
}

export interface ReviewStore {
  /** The organization's reviews, newest first (NFR-13). */
  list(organizationId: string, filter: ReviewListFilter): Promise<{ rows: ReviewRecord[]; total: number }>;
  /** `undefined` for an unknown review or one in another organization. */
  get(organizationId: string, reviewId: string): Promise<ReviewRecord | undefined>;
  /** Stores the Check Run's id and conclusion; a review that doesn't exist (yet) is left alone. */
  recordCheckRun(reviewId: string, checkRun: { checkRunId: number; conclusion: CheckConclusion }): Promise<void>;
  /** The pull request's reviews still queued or running, so a newer commit can cancel them. */
  activeForPullRequest(repositoryId: string, prNumber: number): Promise<ActiveReview[]>;
}

export interface ActiveReview {
  reviewId: string;
  jobId: string;
  headSha: string;
  createdAt: Date;
}

/** The API's `failed` also covers the jobs the database records as `cancelled`. */
export const storedStatuses = (statuses: ReviewStatus[]): (ReviewStatus | "cancelled")[] =>
  statuses.includes("failed") ? [...statuses, "cancelled"] : statuses;

/** Supabase owns sessions; the gateway only asks whether one is still live, so sign-out applies before `exp`. */
export interface SessionStore {
  isActive(sessionId: string): Promise<boolean>;
}

export interface UserStore {
  findById(userId: string): Promise<UserRecord | undefined>;
  /** Inserts or refreshes the `users` row (replaces Supabase's auth trigger); memberships are untouched. */
  recordSignIn(profile: SignInProfile, now: Date): Promise<void>;
  /** Records the user's GitHub identity; throws `GithubAccountTakenError` when another user holds it. */
  linkGithub(userId: string, github: { githubUserId: number; login: string }): Promise<void>;
  /**
   * Adds or updates a membership. A known `role` is GitHub's answer and is applied; `undefined` (GitHub
   * wouldn't say) inserts `member` but never changes an existing role.
   */
  setMembership(organizationId: string, userId: string, role: "admin" | "member" | undefined): Promise<void>;
}

export interface Stores {
  repositories: RepositoryStore;
  repositoryConfig: RepositoryConfigStore;
  reviews: ReviewStore;
  sessions: SessionStore;
  users: UserStore;
  installations: InstallationStore;
  githubTokens: GithubTokenStore;
}
