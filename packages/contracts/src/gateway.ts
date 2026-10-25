import { z } from "zod";

import {
  AgentKindSchema,
  CombinedReportSchema,
  ConfidenceSchema,
  PageInfoSchema,
  RejectionReasonSchema,
  ReviewStatusSchema,
  ReviewSummarySchema,
} from "./common.js";
import { ReviewTriggerSchema } from "./orchestrator.js";

/**
 * Public gateway contract used by the GitHub App and the dashboard.
 * Mirrors `docs/design/openapi/gateway.yaml`. Change the YAML first, then this file.
 */

export const WebhookActionSchema = z.enum([
  "review_started",
  "duplicate_ignored",
  "event_ignored",
  "repository_disabled",
  "installation_synced",
  "branch_ignored",
  /** "Apply all fixes" was clicked on the Check Run; the commit is made in the background. */
  "fixes_applying",
]);
export type WebhookAction = z.infer<typeof WebhookActionSchema>;

/** 202 body of POST /webhooks/github. */
export const WebhookAcceptedSchema = z.object({
  accepted: z.boolean(),
  /** Absent when the event did not warrant a review. */
  reviewId: z.string().uuid().optional(),
  action: WebhookActionSchema.optional(),
});
export type WebhookAccepted = z.infer<typeof WebhookAcceptedSchema>;

/** POST /v1/reviews from the dashboard: review an open pull request's head again (trigger `dashboard_manual`). */
export const PullRequestReviewRequestSchema = z.object({
  repositoryId: z.string().uuid(),
  pullRequestNumber: z.number().int().positive(),
});
export type PullRequestReviewRequest = z.infer<typeof PullRequestReviewRequestSchema>;

export const ReviewAcceptedSchema = z.object({
  reviewId: z.string().uuid(),
  status: z.enum(["queued", "running"]),
  pollUrl: z.string().url().optional(),
  eventsUrl: z.string().url().optional(),
});
export type ReviewAccepted = z.infer<typeof ReviewAcceptedSchema>;

export const CheckConclusionSchema = z.enum(["pass", "fail", "neutral"]);
export type CheckConclusion = z.infer<typeof CheckConclusionSchema>;

/** An agent's worst finding at or above the review's threshold; drives the dashboard's verdict lanes. */
export const AgentResultSchema = z.enum(["critical", "warning", "info", "clean", "not_run", "running"]);
export type AgentResult = z.infer<typeof AgentResultSchema>;

export const ReviewListItemSchema = z.object({
  reviewId: z.string().uuid(),
  repositoryId: z.string().uuid().optional(),
  repositoryFullName: z.string(),
  trigger: ReviewTriggerSchema.optional(),
  pullRequestNumber: z.number().int().optional(),
  pullRequestTitle: z.string().optional(),
  headSha: z.string().optional(),
  status: ReviewStatusSchema,
  /** The GitHub Check Run's result; absent until it completes, and for reviews without one. */
  checkConclusion: CheckConclusionSchema.optional(),
  summary: ReviewSummarySchema,
  /** One entry per agent, in contract order. */
  agentResults: z.array(z.object({ agent: AgentKindSchema, result: AgentResultSchema })).optional(),
  durationMs: z.number().int().min(0).optional(),
  createdAt: z.string().datetime(),
});
export type ReviewListItem = z.infer<typeof ReviewListItemSchema>;

/** Query of GET /v1/reviews. `latest` keeps each pull request's newest review only. */
export const ReviewListQuerySchema = z.object({
  repositoryId: z.string().uuid().optional(),
  status: z
    .string()
    .transform((value) => value.split(","))
    .pipe(z.array(ReviewStatusSchema))
    .optional(),
  latest: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ReviewListQuery = z.infer<typeof ReviewListQuerySchema>;

/** 200 body of GET /v1/reviews/{reviewId}: the combined report plus where it came from, so it still reads as a CombinedReport. */
export const ReviewDetailSchema = CombinedReportSchema.extend({
  repositoryId: z.string().uuid(),
  repositoryFullName: z.string(),
  trigger: ReviewTriggerSchema,
  pullRequestTitle: z.string().optional(),
  headRef: z.string().optional(),
  baseRef: z.string().optional(),
  checkConclusion: CheckConclusionSchema.optional(),
  agentResults: z.array(z.object({ agent: AgentKindSchema, result: AgentResultSchema })),
  createdAt: z.string().datetime(),
  /** When the agents started; with `agentRuns` (the agents that answered so far) it drives the live progress. */
  startedAt: z.string().datetime().optional(),
});
export type ReviewDetail = z.infer<typeof ReviewDetailSchema>;

/** 200 body of GET /v1/reviews, newest first. An empty list is a normal result (UC-5). */
export const ReviewListResponseSchema = z.object({
  items: z.array(ReviewListItemSchema),
  pageInfo: PageInfoSchema,
});
export type ReviewListResponse = z.infer<typeof ReviewListResponseSchema>;

export const RejectSuggestionRequestSchema = z.object({
  reason: RejectionReasonSchema.optional(),
  comment: z.string().max(1000).optional(),
});
export type RejectSuggestionRequest = z.infer<typeof RejectSuggestionRequestSchema>;

export const SuggestionDecisionSchema = z.object({
  findingId: z.string().uuid(),
  suggestionId: z.string().uuid(),
  state: z.enum(["accepted", "rejected"]),
  /** Present when the change was committed to the pull request branch (FR-GH-04). */
  commitSha: z.string().optional(),
  resolvedAt: z.string().datetime().optional(),
});
export type SuggestionDecision = z.infer<typeof SuggestionDecisionSchema>;

/** 200 body of POST /v1/reviews/{reviewId}/apply-all-fixes: every open fix committed in one commit. */
export const ApplyAllFixesResultSchema = z.object({
  reviewId: z.string().uuid(),
  commitSha: z.string(),
  applied: z.number().int().min(1),
  /** How many of the applied fixes were AI-suggested rather than exact. */
  aiApplied: z.number().int().min(0),
  /** Fixes left out: they overlapped a fix that was applied, or their lines changed. */
  skipped: z.number().int().min(0),
});
export type ApplyAllFixesResult = z.infer<typeof ApplyAllFixesResultSchema>;

export const RepositorySchema = z.object({
  repositoryId: z.string().uuid(),
  fullName: z.string(),
  defaultBranch: z.string().optional(),
  primaryLanguage: z.string().optional(),
  isPrivate: z.boolean().optional(),
  reviewEnabled: z.boolean(),
  lastReviewAt: z.string().datetime().optional(),
});
export type Repository = z.infer<typeof RepositorySchema>;

export const RepositoryListResponseSchema = z.object({
  items: z.array(RepositorySchema),
});
export type RepositoryListResponse = z.infer<typeof RepositoryListResponseSchema>;

/** One open pull request from GitHub, with its newest Code Sentinel review. */
export const PullRequestListItemSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  /** The author's GitHub login. */
  author: z.string().optional(),
  headSha: z.string(),
  headRef: z.string(),
  baseRef: z.string(),
  draft: z.boolean(),
  updatedAt: z.string().datetime(),
  htmlUrl: z.string().url(),
  /** Whether the base branch is one of the repository's branches to review. */
  reviewable: z.boolean(),
  latestReview: ReviewListItemSchema.nullable(),
});
export type PullRequestListItem = z.infer<typeof PullRequestListItemSchema>;

/** 200 body of GET /v1/repositories/{repositoryId}/pulls: open pull requests, most recently updated first. */
export const PullRequestListResponseSchema = z.object({
  items: z.array(PullRequestListItemSchema),
});
export type PullRequestListResponse = z.infer<typeof PullRequestListResponseSchema>;

/** 200 body of GET /v1/repositories/{repositoryId}/branches: branch names A–Z; `truncated` when GitHub had more. */
export const BranchListResponseSchema = z.object({
  items: z.array(z.string()),
  truncated: z.boolean(),
});
export type BranchListResponse = z.infer<typeof BranchListResponseSchema>;

/** A GitHub account (personal or organization) where the App is installed, as a member sees it. */
export const InstallationSchema = z.object({
  organizationId: z.string().uuid(),
  accountLogin: z.string(),
  accountType: z.enum(["user", "organization"]),
  suspended: z.boolean(),
  repositoryCount: z.number().int().nonnegative(),
});
export type Installation = z.infer<typeof InstallationSchema>;

export const InstallationListResponseSchema = z.object({
  items: z.array(InstallationSchema),
});
export type InstallationListResponse = z.infer<typeof InstallationListResponseSchema>;

/** Body of POST /v1/github/link: the `code` GitHub sent to the dashboard's callback. */
export const GithubLinkRequestSchema = z.object({
  code: z.string().min(1).max(200),
});
export type GithubLinkRequest = z.infer<typeof GithubLinkRequestSchema>;

/** 200 body of POST /v1/github/link and POST /v1/installations/sync. */
export const GithubLinkResultSchema = z.object({
  githubLogin: z.string(),
  installations: z.array(InstallationSchema.omit({ suspended: true })),
});
export type GithubLinkResult = z.infer<typeof GithubLinkResultSchema>;

/** `off` skips the agent; `comment` posts its findings; `block` also fails the Check Run on its warnings. Critical findings always fail it. */
export const AgentModeSchema = z.enum(["off", "comment", "block"]);
export type AgentMode = z.infer<typeof AgentModeSchema>;

export const AgentModeSourceSchema = z.enum(["repository", "organization_default", "platform_default"]);
export type AgentModeSource = z.infer<typeof AgentModeSourceSchema>;

/** One agent's effective mode and where it came from. */
export const AgentSettingSchema = z.object({
  agent: AgentKindSchema,
  mode: AgentModeSchema,
  source: AgentModeSourceSchema,
});
export type AgentSetting = z.infer<typeof AgentSettingSchema>;

export const AgentModeUpdateSchema = z.object({
  agent: AgentKindSchema,
  mode: AgentModeSchema,
});
export type AgentModeUpdate = z.infer<typeof AgentModeUpdateSchema>;

/** A base-branch name or glob (`main`, `release/*`, `hotfix/**`); `*` is one path segment, `**` any number. */
export const ReviewBranchPatternSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^\S+$/, "Branch patterns cannot contain spaces")
  .refine((pattern) => !pattern.includes(".."), "Branch patterns cannot contain '..'");

/** Empty means the repository's default branch only. */
export const ReviewBranchesSchema = z.array(ReviewBranchPatternSchema).max(20);

const AgentModeUpdatesSchema = z
  .array(AgentModeUpdateSchema)
  .min(1)
  .refine((items) => new Set(items.map((item) => item.agent)).size === items.length, "Each agent may appear once");

export const ThresholdSourceSchema = z.enum([
  "repository_override",
  "organization_default",
  "platform_default",
]);
export type ThresholdSource = z.infer<typeof ThresholdSourceSchema>;

/** Effective configuration plus where each value came from (UC-4). */
export const RepositoryConfigSchema = z.object({
  repositoryId: z.string().uuid(),
  fullName: z.string(),
  defaultBranch: z.string(),
  reviewEnabled: z.boolean(),
  /** True: agent modes come from the organization's review defaults. Branches are always the repository's own. */
  useOrgDefaults: z.boolean(),
  /** In `AgentKindSchema` order. */
  agents: z.array(AgentSettingSchema),
  /** The repository's own patterns; empty means its default branch only. */
  reviewBranches: ReviewBranchesSchema,
  /** The patterns that apply now; never empty (the default branch when nothing is set). */
  effectiveReviewBranches: z.array(z.string()).min(1),
  /** null means no override is set for this repository. */
  confidenceThresholdOverride: ConfidenceSchema.nullable().optional(),
  effectiveConfidenceThreshold: ConfidenceSchema,
  thresholdSource: ThresholdSourceSchema,
  agentTimeoutMs: z.number().int().optional(),
  autoFixStyle: z.boolean().optional(),
  postInlineComments: z.boolean().optional(),
  updatedAt: z.string().datetime().optional(),
  updatedBy: z.string().optional(),
});
export type RepositoryConfig = z.infer<typeof RepositoryConfigSchema>;

/** Configuration writes need an authenticator code entered this many minutes ago at most (A7, 403 `mfa_required`). */
export const DEFAULT_MFA_STEP_UP_MINUTES = 10;

/** The step-up rule shared by the gateway and the dashboard: `aal2` with a `totp` entry in `amr` (Unix seconds) at most `minutes` old. */
export function isStepUpFresh(
  claims: { aal?: string; amr?: readonly { method: string; timestamp: number }[] },
  nowMs: number,
  minutes: number = DEFAULT_MFA_STEP_UP_MINUTES,
): boolean {
  const totpAt = claims.aal === "aal2" ? claims.amr?.find((entry) => entry.method === "totp")?.timestamp : undefined;
  return totpAt !== undefined && nowMs - totpAt * 1000 <= minutes * 60_000;
}

/**
 * A partial update: omitted fields keep their value. Turning every agent off is rejected with 400
 * `no_agents_enabled` (UC-4 exception flow); switch `reviewEnabled` off instead.
 */
export const RepositoryConfigUpdateSchema = z.object({
  reviewEnabled: z.boolean().optional(),
  useOrgDefaults: z.boolean().optional(),
  /** Only the listed agents change. */
  agents: AgentModeUpdatesSchema.optional(),
  reviewBranches: ReviewBranchesSchema.optional(),
  /** null restores inheritance from the organization default (FR-ORC-06). */
  confidenceThresholdOverride: ConfidenceSchema.nullable().optional(),
  agentTimeoutMs: z.number().int().min(1000).max(120000).optional(),
  autoFixStyle: z.boolean().optional(),
  postInlineComments: z.boolean().optional(),
});
export type RepositoryConfigUpdate = z.infer<typeof RepositoryConfigUpdateSchema>;

/** An organization's review defaults, used by its repositories that follow them. */
export const ReviewDefaultsSchema = z.object({
  organizationId: z.string().uuid(),
  /** In `AgentKindSchema` order; `source` is `organization_default` or `platform_default`. */
  agents: z.array(AgentSettingSchema),
  confidenceThreshold: ConfidenceSchema,
});
export type ReviewDefaults = z.infer<typeof ReviewDefaultsSchema>;

/** A partial update; turning every agent off is rejected with 400 `no_agents_enabled`. */
export const ReviewDefaultsUpdateSchema = z.object({
  agents: AgentModeUpdatesSchema.optional(),
  confidenceThreshold: ConfidenceSchema.optional(),
});
export type ReviewDefaultsUpdate = z.infer<typeof ReviewDefaultsUpdateSchema>;

export const OrgRoleSchema = z.enum(["admin", "member"]);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

export const OrganizationMembershipSchema = z.object({
  organizationId: z.string().uuid(),
  displayName: z.string(),
  role: OrgRoleSchema,
});
export type OrganizationMembership = z.infer<typeof OrganizationMembershipSchema>;

export const CurrentUserSchema = z.object({
  userId: z.string().uuid(),
  // Absent until the user links GitHub (email and Google sign-ins have none).
  githubLogin: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  avatarUrl: z.string().optional(),
  /** Sign-in methods linked to the account (`email`, `github`, `google`). */
  providers: z.array(z.string()).optional(),
  organizations: z.array(OrganizationMembershipSchema),
});
export type CurrentUser = z.infer<typeof CurrentUserSchema>;

/** One of the caller's signed-in devices (a Supabase session). */
export const SessionSchema = z.object({
  sessionId: z.string().uuid(),
  createdAt: z.string().datetime(),
  lastActiveAt: z.string().datetime().optional(),
  userAgent: z.string().optional(),
  ip: z.string().optional(),
  /** The session making this request. */
  current: z.boolean(),
});
export type Session = z.infer<typeof SessionSchema>;

export const SessionListSchema = z.object({ items: z.array(SessionSchema) });
export type SessionList = z.infer<typeof SessionListSchema>;

/** `unknown` when the orchestrator did not answer; `unavailable` also covers an agent with no URL. */
export const AgentsHealthSchema = z.object({
  checkedAt: z.string().datetime().optional(),
  agents: z.array(
    z.object({
      agent: AgentKindSchema,
      status: z.enum(["ok", "degraded", "asleep", "unavailable", "unknown"]),
      latencyMs: z.number().int().min(0).optional(),
    }),
  ),
});
export type AgentsHealth = z.infer<typeof AgentsHealthSchema>;

export const AuditActionSchema = z.enum([
  "repository_config_updated",
  "review_defaults_updated",
  "repository_reviews_toggled",
  "fix_accepted",
  "fix_rejected",
  "fixes_applied",
  "review_rerun",
  "github_linked",
  "installations_synced",
  "session_revoked",
  "step_up_refused",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditTargetTypeSchema = z.enum(["repository", "organization", "suggestion", "review", "session", "installation", "user"]);
export type AuditTargetType = z.infer<typeof AuditTargetTypeSchema>;

export const AuditEventSchema = z.object({
  eventId: z.string().uuid(),
  action: AuditActionSchema,
  /** Absent for an action from GitHub by someone with no account here; their login is in `metadata`. */
  userId: z.string().uuid().optional(),
  /** The user's name, email or GitHub login, for display. */
  actor: z.string().optional(),
  targetType: AuditTargetTypeSchema.optional(),
  targetId: z.string().optional(),
  ip: z.string().optional(),
  userAgent: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const AuditEventListSchema = z.object({
  items: z.array(AuditEventSchema),
  /** Pass as `before` for the next page; absent on the last page. */
  nextBefore: z.string().datetime().optional(),
});
export type AuditEventList = z.infer<typeof AuditEventListSchema>;

export const GatewayHealthSchema = z.object({
  status: z.enum(["ok", "degraded", "unavailable"]).optional(),
  version: z.string().optional(),
  dependencies: z.record(z.string()).optional(),
});
export type GatewayHealth = z.infer<typeof GatewayHealthSchema>;
