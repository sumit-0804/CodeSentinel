import { z } from "zod";

import {
  AgentKindSchema,
  AgentRunSummarySchema,
  ApiErrorSchema,
  ChangedFileSchema,
  CombinedReportSchema,
  ConfidenceSchema,
  SkippedFileSchema,
} from "./common.js";
import { HealthStatusSchema } from "./agent.js";

/**
 * Internal contract between the API Gateway and the orchestrator.
 * Mirrors `docs/design/openapi/orchestrator.yaml`. Change the YAML first, then this file.
 */

export const ReviewTriggerSchema = z.enum([
  "github_pull_request",
  "vscode_on_demand",
  "dashboard_manual",
]);
export type ReviewTrigger = z.infer<typeof ReviewTriggerSchema>;

/** Present when trigger is github_pull_request. */
export const ReviewJobPullRequestSchema = z.object({
  number: z.number().int().optional(),
  title: z.string().optional(),
  headRef: z.string().optional(),
  baseRef: z.string().optional(),
});
export type ReviewJobPullRequest = z.infer<typeof ReviewJobPullRequestSchema>;

export const ReviewJobRequestSchema = z.object({
  repositoryId: z.string().uuid(),
  /** Carried on every job so retrieval and storage stay inside one tenant (NFR-13). */
  organizationId: z.string().uuid(),
  trigger: ReviewTriggerSchema,
  triggeredByUserId: z.string().uuid().optional(),
  pullRequest: ReviewJobPullRequestSchema.optional(),
  headSha: z.string(),
  baseSha: z.string().optional(),
  /** Files that passed the gateway filter. An all-filtered PR never reaches the orchestrator. */
  files: z.array(ChangedFileSchema).min(1),
  /** Files the gateway dropped before fan-out; carried into CombinedReport.skippedFiles. */
  skippedFiles: z.array(SkippedFileSchema).optional(),
  /** Resolved by the gateway from repository_agent_config (FR-WEB-02). Omitted means all five. */
  enabledAgents: z.array(AgentKindSchema).optional(),
  /** Repository override if set, otherwise the platform default of 0.8 (FR-ORC-06, FR-WEB-03). */
  confidenceThreshold: ConfidenceSchema.optional(),
  /** Per-agent budget. On expiry the orchestrator proceeds with partial results (NFR-02). */
  agentTimeoutMs: z.number().int().min(1000).max(120000).default(20000),
  /** Set false to skip the vector database lookup (FR-ORC-05). */
  includeSimilarPastIssues: z.boolean().default(true),
  /** Called once with the completed job when the fan-out finishes. */
  callbackUrl: z.string().url().optional(),
});
export type ReviewJobRequest = z.infer<typeof ReviewJobRequestSchema>;
/** Shape before defaults are applied, i.e. what a caller sends. */
export type ReviewJobRequestInput = z.input<typeof ReviewJobRequestSchema>;

/** ReviewStatus plus cancelled, which only a job (not a report) can be. */
export const ReviewJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
]);
export type ReviewJobStatus = z.infer<typeof ReviewJobStatusSchema>;

export const ReviewJobSchema = z.object({
  jobId: z.string().uuid(),
  reviewId: z.string().uuid(),
  status: ReviewJobStatusSchema,
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  /** While running, shows which agents have already answered. */
  agentRuns: z.array(AgentRunSummarySchema).optional(),
  /** Populated once status is completed or partial. */
  report: CombinedReportSchema.optional(),
  error: ApiErrorSchema.optional(),
});
export type ReviewJob = z.infer<typeof ReviewJobSchema>;

export const AgentHealthEntrySchema = z.object({
  agent: AgentKindSchema,
  status: HealthStatusSchema,
  latencyMs: z.number().int().min(0).optional(),
  version: z.string().optional(),
});
export type AgentHealthEntry = z.infer<typeof AgentHealthEntrySchema>;

/** Body of GET /internal/v1/agents/health: the orchestrator's cached view of each agent. */
export const AgentHealthSnapshotSchema = z.object({
  checkedAt: z.string().datetime(),
  agents: z.array(AgentHealthEntrySchema),
});
export type AgentHealthSnapshot = z.infer<typeof AgentHealthSnapshotSchema>;
