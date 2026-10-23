import type {
  AgentKind,
  AgentMode,
  AuditAction,
  AuditEvent,
  AuditTargetType,
  CheckConclusion,
  CombinedReport,
  OrganizationMembership,
  RejectionReason,
  RepositoryConfigUpdate,
  ReviewDefaultsUpdate,
  ReviewStatus,
  ReviewTrigger,
  SuggestionKind,
  SuggestionState,
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
  /** Agents in `block` mode: their warnings fail the Check Run too, not only critical findings. */
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

/**
 * Which repositories of one organization a caller may read (NFR-13). `repositoryIds` is set for a
 * `member`: only the repositories they can open on GitHub. Absent for an admin: every repository.
 */
export interface RepositoryScope {
  organizationId: string;
  repositoryIds?: readonly string[];
}

/** An `organization_members` row; a member's `repositoryIds` come from `repository_members`. */
export interface MembershipRecord extends OrganizationMembership {
  repositoryIds?: string[];
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
  memberships: MembershipRecord[];
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
  /** The same live repository by id, only if it is in the caller's scope (NFR-13). */
  findForOrganization(scope: RepositoryScope, repositoryId: string): Promise<RepositoryRecord | undefined>;
  /** The active repositories in the caller's scope, by name. */
  listForOrganization(scope: RepositoryScope): Promise<RepositorySummary[]>;
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
  /** The reviews in the caller's scope, newest first (NFR-13). */
  list(scope: RepositoryScope, filter: ReviewListFilter): Promise<{ rows: ReviewRecord[]; total: number }>;
  /** `undefined` for an unknown review or one outside the caller's scope. */
  get(scope: RepositoryScope, reviewId: string): Promise<ReviewRecord | undefined>;
  /** The review whose Check Run this is, for a button clicked on GitHub; `undefined` when none. */
  findByCheckRun(checkRunId: number): Promise<ReviewRecord | undefined>;
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
/** A signed-in device: one of the user's live Supabase sessions (`auth.sessions`). */
export interface SessionRecord {
  sessionId: string;
  createdAt: Date;
  lastActiveAt?: Date;
  userAgent?: string;
  ip?: string;
}

/** What the gateway saw of a session's device; it overrides Supabase's, which is the dashboard's server. */
export interface SessionActivity {
  sessionId: string;
  userId: string;
  ip?: string;
  userAgent?: string;
}

export interface SessionActivityRecord extends SessionActivity {
  lastSeenAt: Date;
}

/** The gateway's view of each device wins over Supabase's; last active is the later of the two. */
export function withSessionActivity(sessions: SessionRecord[], activity: SessionActivityRecord[]): SessionRecord[] {
  const byId = new Map(activity.map((row) => [row.sessionId, row]));
  return sessions
    .map((session) => {
      const seen = byId.get(session.sessionId);
      if (!seen) return session;
      const lastActiveAt = session.lastActiveAt && session.lastActiveAt > seen.lastSeenAt ? session.lastActiveAt : seen.lastSeenAt;
      return { ...session, lastActiveAt, ...(seen.ip ? { ip: seen.ip } : {}), ...(seen.userAgent ? { userAgent: seen.userAgent } : {}) };
    })
    .sort((a, b) => (b.lastActiveAt ?? b.createdAt).getTime() - (a.lastActiveAt ?? a.createdAt).getTime());
}

export interface SessionStore {
  isActive(sessionId: string): Promise<boolean>;
  /** Records the device behind a request (`session_activity`). */
  touch(activity: SessionActivity, at: Date): Promise<void>;
  /** The user's live sessions, most recently active first, with the device the gateway last saw on each. */
  listForUser(userId: string): Promise<SessionRecord[]>;
  /** Signs that session out at once; `false` when it isn't one of the user's live sessions. */
  revoke(userId: string, sessionId: string): Promise<boolean>;
}

export interface UserStore {
  findById(userId: string): Promise<UserRecord | undefined>;
  /** The user who linked this GitHub account, if anyone did. */
  findByGithubId(githubUserId: number): Promise<UserRecord | undefined>;
  /** Inserts or refreshes the `users` row (replaces Supabase's auth trigger); memberships are untouched. */
  recordSignIn(profile: SignInProfile, now: Date): Promise<void>;
  /** Records the user's GitHub identity; throws `GithubAccountTakenError` when another user holds it. */
  linkGithub(userId: string, github: { githubUserId: number; login: string }): Promise<void>;
  /**
   * Adds or updates a membership. A known `role` is GitHub's answer and is applied; `undefined` (GitHub
   * wouldn't say) inserts `member` but never changes an existing role.
   */
  setMembership(organizationId: string, userId: string, role: "admin" | "member" | undefined): Promise<void>;
  /**
   * Makes `githubRepoIds` exactly the member's repositories in the organization (`repository_members`);
   * ids the organization doesn't have are ignored. `undefined` clears them, for an admin.
   */
  setRepositoryAccess(organizationId: string, userId: string, githubRepoIds: number[] | undefined): Promise<void>;
}

/** A `suggestions` row with its finding and the review it came from (UC-3). */
export interface SuggestionRecord {
  suggestionId: string;
  findingId: string;
  reviewId: string;
  organizationId: string;
  repositoryId: string;
  /** The reviewed pull request and commit, so an accepted fix is committed only onto that head. */
  prNumber?: number;
  headSha: string;
  agent: AgentKind;
  ruleId: string;
  title: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  kind: SuggestionKind;
  state: SuggestionState;
  originalSnippet: string;
  suggestedSnippet: string;
  githubCommentId?: number;
  resolutionCommitSha?: string;
  rejectionReason?: RejectionReason;
  resolvedAt?: Date;
}

export interface SuggestionStore {
  /** Every suggestion of a review, for the review detail and for matching posted comments. */
  forReview(reviewId: string): Promise<SuggestionRecord[]>;
  /** The suggestion of a finding, only within the caller's scope (NFR-13); `undefined` if it has none. */
  findByFinding(scope: RepositoryScope, findingId: string): Promise<SuggestionRecord | undefined>;
  /** Marks the suggestions posted as inline comments, with GitHub's comment ids. */
  recordPosted(posted: { suggestionId: string; commentId: number }[]): Promise<void>;
  /**
   * Records a decision only while the suggestion is `proposed`; `false` when someone or something decided first.
   * Without a `userId` only an exact (deterministic) fix can be accepted: an AI fix needs a person (FR-GH-04).
   */
  accept(suggestionId: string, decision: { userId?: string; commitSha?: string; at: Date }): Promise<boolean>;
  reject(suggestionId: string, decision: { userId: string; reason?: RejectionReason; comment?: string; at: Date }): Promise<boolean>;
}

/** One sensitive action for the admins' audit log (`audit_events`). */
export interface AuditEventInput {
  action: AuditAction;
  organizationId?: string;
  /** Absent for an action from GitHub by someone with no account here; put their login in `metadata`. */
  userId?: string;
  targetType?: AuditTargetType;
  targetId?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
  at: Date;
}

export interface AuditStore {
  record(event: AuditEventInput): Promise<void>;
  /** Newest first, strictly before `before` when given; `actor` is the user's name, GitHub login or email. */
  listForOrganization(organizationId: string, page: { before?: Date; limit: number }): Promise<AuditEvent[]>;
}

export interface Stores {
  audit: AuditStore;
  repositories: RepositoryStore;
  repositoryConfig: RepositoryConfigStore;
  reviews: ReviewStore;
  suggestions: SuggestionStore;
  sessions: SessionStore;
  users: UserStore;
  installations: InstallationStore;
  githubTokens: GithubTokenStore;
}
