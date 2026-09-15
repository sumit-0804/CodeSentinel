import { z } from "zod";

/**
 * Schemas shared by the Gateway, Orchestrator and Agent contracts.
 * Mirrors `docs/design/openapi/common.yaml`. Change the YAML first, then this file.
 */

export const AgentKindSchema = z.enum([
  "security",
  "style",
  "performance",
  "logic",
  "documentation",
]);
export type AgentKind = z.infer<typeof AgentKindSchema>;

export const SeveritySchema = z.enum(["critical", "warning", "info"]);
export type Severity = z.infer<typeof SeveritySchema>;

/** Model or rule confidence in [0, 1]. Compared against the repository threshold (default 0.8). */
export const ConfidenceSchema = z.number().min(0).max(1);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const LanguageSchema = z.enum(["javascript", "typescript", "python", "unknown"]);
export type Language = z.infer<typeof LanguageSchema>;

export const CodeLocationSchema = z.object({
  filePath: z.string(),
  lineStart: z.number().int().min(1),
  lineEnd: z.number().int().min(1),
});
export type CodeLocation = z.infer<typeof CodeLocationSchema>;

export const ChangeTypeSchema = z.enum(["added", "modified", "renamed", "deleted"]);
export type ChangeType = z.infer<typeof ChangeTypeSchema>;

export const ChangedFileSchema = z.object({
  path: z.string(),
  language: LanguageSchema,
  changeType: ChangeTypeSchema.default("modified"),
  /** Present only when changeType is renamed. */
  previousPath: z.string().optional(),
  /** Unified diff hunks for this file only, never the whole file (NFR-06). */
  patch: z.string(),
  contextBefore: z.string().optional(),
});
export type ChangedFile = z.infer<typeof ChangedFileSchema>;

/**
 * too_large: the file alone exceeds the size limit. over_budget: it fit on its own but the
 * review's LLM token budget was already spent. Large diffs are skipped, never split.
 */
export const SkipReasonSchema = z.enum([
  "unsupported_language",
  "too_large",
  "generated_file",
  "binary",
  "over_budget",
]);
export type SkipReason = z.infer<typeof SkipReasonSchema>;

export const SkippedFileSchema = z.object({
  path: z.string(),
  reason: SkipReasonSchema,
});
export type SkippedFile = z.infer<typeof SkippedFileSchema>;

export const ReportSkippedFileSchema = SkippedFileSchema.extend({
  /** Agents that skipped the file. Absent when the gateway dropped it before fan-out. */
  agents: z.array(AgentKindSchema).optional(),
});
export type ReportSkippedFile = z.infer<typeof ReportSkippedFileSchema>;

/** A file counts as reviewed when at least one agent that succeeded analyzed it. */
export const ReviewCoverageSchema = z.object({
  filesTotal: z.number().int().min(0),
  filesReviewed: z.number().int().min(0),
  changedLinesTotal: z.number().int().min(0),
  changedLinesReviewed: z.number().int().min(0),
});
export type ReviewCoverage = z.infer<typeof ReviewCoverageSchema>;

/** deterministic fixes involve no LLM (NFR-07); ai_suggested fixes need an explicit developer action (FR-GH-04). */
export const SuggestionKindSchema = z.enum(["deterministic", "ai_suggested"]);
export type SuggestionKind = z.infer<typeof SuggestionKindSchema>;

export const SuggestionStateSchema = z.enum(["proposed", "accepted", "rejected", "superseded"]);
export type SuggestionState = z.infer<typeof SuggestionStateSchema>;

export const SuggestionSchema = z.object({
  id: z.string().uuid().optional(),
  kind: SuggestionKindSchema,
  state: SuggestionStateSchema.optional(),
  originalSnippet: z.string(),
  suggestedSnippet: z.string(),
  explanation: z.string().optional(),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

export const SimilarPastIssueSchema = z.object({
  findingId: z.string().uuid(),
  similarityScore: z.number().min(0).max(1),
  title: z.string(),
  repositoryFullName: z.string().optional(),
  resolution: z.string().optional(),
  occurredAt: z.string().datetime().optional(),
});
export type SimilarPastIssue = z.infer<typeof SimilarPastIssueSchema>;

export const FindingSchema = z.object({
  id: z.string().uuid().optional(),
  agent: AgentKindSchema,
  ruleId: z.string(),
  title: z.string(),
  description: z.string(),
  location: CodeLocationSchema,
  severity: SeveritySchema,
  confidence: ConfidenceSchema,
  cweId: z.string().optional(),
  suggestion: SuggestionSchema.optional(),
  /** Attached by the orchestrator from the vector database (FR-ORC-05). Agents never populate this. */
  similarPastIssues: z.array(SimilarPastIssueSchema).optional(),
  /** How many agents reported this same issue before de-duplication (FR-ORC-03). */
  duplicateCount: z.number().int().min(1).optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

/** timed_out and failed still produce a report; the agent is marked "no result" (FR-ORC-02, NFR-04). */
export const AgentRunStatusSchema = z.enum(["succeeded", "timed_out", "failed", "skipped"]);
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

export const AgentRunSummarySchema = z.object({
  agent: AgentKindSchema,
  status: AgentRunStatusSchema,
  findingsCount: z.number().int().min(0).optional(),
  latencyMs: z.number().int().min(0).optional(),
  /** Always gemini; there is no provider fallback (NFR-11, NFR-14). */
  llmProvider: z.string().optional(),
  /** llm_quota_exhausted when the agent could not fit into the Gemini quota before the deadline. */
  errorCode: z.string().optional(),
});
export type AgentRunSummary = z.infer<typeof AgentRunSummarySchema>;

export const ReviewSummarySchema = z.object({
  criticalCount: z.number().int().min(0),
  warningCount: z.number().int().min(0),
  infoCount: z.number().int().min(0),
  /** Style issues fixed deterministically, with no LLM involved. */
  autoFixedCount: z.number().int().min(0),
  suggestedFixCount: z.number().int().min(0),
});
export type ReviewSummary = z.infer<typeof ReviewSummarySchema>;

/** partial: at least one agent timed out, failed or was deferred by quota, but a report was produced. */
export const ReviewStatusSchema = z.enum(["queued", "running", "completed", "partial", "failed"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const CombinedReportSchema = z.object({
  reviewId: z.string().uuid(),
  status: ReviewStatusSchema,
  repositoryFullName: z.string().optional(),
  pullRequestNumber: z.number().int().optional(),
  headSha: z.string().optional(),
  confidenceThreshold: ConfidenceSchema.optional(),
  summary: ReviewSummarySchema,
  /** De-duplicated and ranked by severity, then by confidence (FR-ORC-03, FR-ORC-04). */
  findings: z.array(FindingSchema),
  agentRuns: z.array(AgentRunSummarySchema),
  /** One entry per path and reason, from the gateway and every agent. */
  skippedFiles: z.array(ReportSkippedFileSchema).optional(),
  coverage: ReviewCoverageSchema.optional(),
  durationMs: z.number().int().min(0).optional(),
  completedAt: z.string().datetime().optional(),
});
export type CombinedReport = z.infer<typeof CombinedReportSchema>;

/** The OpenAPI `Error` schema, named ApiError so it does not shadow the global Error. */
export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  /** Echoed in every response and written to the run log (NFR-12). */
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const PageInfoSchema = z.object({
  total: z.number().int().min(0),
  limit: z.number().int().min(0),
  offset: z.number().int().min(0),
});
export type PageInfo = z.infer<typeof PageInfoSchema>;
