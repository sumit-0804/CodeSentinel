import { z } from "zod";

import {
  AgentKindSchema,
  ChangedFileSchema,
  ConfidenceSchema,
  PageInfoSchema,
  ReviewStatusSchema,
  ReviewSummarySchema,
} from "./common.js";
import { ReviewTriggerSchema } from "./orchestrator.js";

/**
 * Public gateway contract used by the GitHub App, the VS Code extension and the dashboard.
 * Mirrors `docs/design/openapi/gateway.yaml`. Change the YAML first, then this file.
 */

export const WebhookActionSchema = z.enum([
  "review_started",
  "duplicate_ignored",
  "event_ignored",
  "repository_disabled",
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

/** POST /v1/reviews: on-demand review from VS Code or the dashboard (FR-VSC-01). */
export const CreateReviewRequestSchema = z.object({
  repositoryId: z.string().uuid(),
  files: z.array(ChangedFileSchema).min(1).max(200),
  /** Commit the files came from, when the workspace is a clean checkout. */
  headSha: z.string().optional(),
  /** Restrict this one review to a subset. Repository configuration still applies on top. */
  agents: z.array(AgentKindSchema).optional(),
});
export type CreateReviewRequest = z.infer<typeof CreateReviewRequestSchema>;

export const ReviewAcceptedSchema = z.object({
  reviewId: z.string().uuid(),
  status: z.enum(["queued", "running"]),
  pollUrl: z.string().url().optional(),
  eventsUrl: z.string().url().optional(),
});
export type ReviewAccepted = z.infer<typeof ReviewAcceptedSchema>;

export const CheckConclusionSchema = z.enum(["pass", "fail", "neutral"]);
export type CheckConclusion = z.infer<typeof CheckConclusionSchema>;

export const ReviewListItemSchema = z.object({
  reviewId: z.string().uuid(),
  repositoryFullName: z.string(),
  trigger: ReviewTriggerSchema.optional(),
  pullRequestNumber: z.number().int().optional(),
  pullRequestTitle: z.string().optional(),
  status: ReviewStatusSchema,
  checkConclusion: CheckConclusionSchema.optional(),
  summary: ReviewSummarySchema,
  durationMs: z.number().int().min(0).optional(),
  createdAt: z.string().datetime(),
});
export type ReviewListItem = z.infer<typeof ReviewListItemSchema>;

/** 200 body of GET /v1/reviews, newest first. An empty list is a normal result (UC-5). */
export const ReviewListResponseSchema = z.object({
  items: z.array(ReviewListItemSchema),
  pageInfo: PageInfoSchema,
});
export type ReviewListResponse = z.infer<typeof ReviewListResponseSchema>;

export const StyleFixedFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  fixesApplied: z.number().int().min(0).optional(),
});
export type StyleFixedFile = z.infer<typeof StyleFixedFileSchema>;

/** 200 body of POST /v1/reviews/{reviewId}/style-fixes. No LLM is involved (NFR-07). */
export const StyleFixesResponseSchema = z.object({
  fixedCount: z.number().int().min(0),
  files: z.array(StyleFixedFileSchema),
});
export type StyleFixesResponse = z.infer<typeof StyleFixesResponseSchema>;

/** editor_buffer records the decision without touching GitHub. */
export const AcceptSuggestionRequestSchema = z.object({
  target: z.enum(["github_branch", "editor_buffer"]).default("github_branch"),
});
export type AcceptSuggestionRequest = z.infer<typeof AcceptSuggestionRequestSchema>;

export const RejectSuggestionRequestSchema = z.object({
  reason: z.enum(["false_positive", "not_applicable", "will_fix_manually", "other"]).optional(),
  comment: z.string().optional(),
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

export const AgentSettingSchema = z.object({
  agent: AgentKindSchema,
  enabled: z.boolean(),
});
export type AgentSetting = z.infer<typeof AgentSettingSchema>;

export const ThresholdSourceSchema = z.enum([
  "repository_override",
  "organization_default",
  "platform_default",
]);
export type ThresholdSource = z.infer<typeof ThresholdSourceSchema>;

/** Effective configuration plus where each value came from (UC-4). */
export const RepositoryConfigSchema = z.object({
  repositoryId: z.string().uuid(),
  agents: z.array(AgentSettingSchema),
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

/** Disabling every agent is rejected (UC-4 exception flow), hence minItems 1. */
export const RepositoryConfigUpdateSchema = z.object({
  agents: z.array(AgentSettingSchema).min(1).optional(),
  /** Omitted or null restores inheritance from the platform default of 0.8 (FR-ORC-06). */
  confidenceThresholdOverride: ConfidenceSchema.nullable().optional(),
  agentTimeoutMs: z.number().int().min(1000).max(120000).optional(),
  autoFixStyle: z.boolean().optional(),
  postInlineComments: z.boolean().optional(),
});
export type RepositoryConfigUpdate = z.infer<typeof RepositoryConfigUpdateSchema>;

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
  githubLogin: z.string(),
  email: z.string().optional(),
  avatarUrl: z.string().optional(),
  organizations: z.array(OrganizationMembershipSchema),
});
export type CurrentUser = z.infer<typeof CurrentUserSchema>;

/** Prefix only; the secret is shown once at creation and never again. */
export const ApiKeySchema = z.object({
  keyId: z.string().uuid(),
  label: z.string(),
  keyPrefix: z.string(),
  lastUsedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

export const ApiKeyListResponseSchema = z.object({
  items: z.array(ApiKeySchema).optional(),
});
export type ApiKeyListResponse = z.infer<typeof ApiKeyListResponseSchema>;

export const CreateApiKeyRequestSchema = z.object({
  label: z.string().min(1),
});
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>;

/** 201 body of POST /v1/me/api-keys. The plaintext secret appears here only. */
export const CreatedApiKeySchema = ApiKeySchema.extend({
  secret: z.string().optional(),
});
export type CreatedApiKey = z.infer<typeof CreatedApiKeySchema>;

export const GatewayHealthSchema = z.object({
  status: z.enum(["ok", "degraded", "unavailable"]).optional(),
  version: z.string().optional(),
  dependencies: z.record(z.string()).optional(),
});
export type GatewayHealth = z.infer<typeof GatewayHealthSchema>;
