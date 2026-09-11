/**
 * Contract types shared across Code-Sentinel services.
 *
 * These mirror `docs/design/openapi/common.yaml`. They live here for now so the orchestrator
 * scaffold compiles on its own; once a second service needs them they should move into a
 * dedicated `packages/contracts` workspace.
 */

export type AgentKind =
  | "security"
  | "style"
  | "performance"
  | "logic"
  | "documentation";

export type Severity = "critical" | "warning" | "info";

/** Model or rule confidence in [0, 1]. Compared against the repository threshold (default 0.8). */
export type Confidence = number;

export interface CodeLocation {
  filePath: string;
  lineStart: number;
  lineEnd: number;
}

export type SuggestionKind = "deterministic" | "ai_suggested";
export type SuggestionState = "proposed" | "accepted" | "rejected" | "superseded";

export interface Suggestion {
  id?: string;
  kind: SuggestionKind;
  state?: SuggestionState;
  originalSnippet: string;
  suggestedSnippet: string;
  explanation?: string;
}

export interface SimilarPastIssue {
  findingId: string;
  similarityScore: number;
  title: string;
  repositoryFullName?: string;
  resolution?: string;
  occurredAt?: string;
}

export interface Finding {
  id?: string;
  agent: AgentKind;
  ruleId: string;
  title: string;
  description: string;
  location: CodeLocation;
  severity: Severity;
  confidence: Confidence;
  cweId?: string;
  suggestion?: Suggestion;
  /** Attached by the orchestrator from the vector database (FR-ORC-05). Agents never populate this. */
  similarPastIssues?: SimilarPastIssue[];
  /** How many agents reported this same issue before de-duplication (FR-ORC-03). */
  duplicateCount?: number;
}

export type AgentRunStatus = "succeeded" | "timed_out" | "failed" | "skipped";

export interface AgentRunSummary {
  agent: AgentKind;
  status: AgentRunStatus;
  findingsCount?: number;
  latencyMs?: number;
  llmProvider?: string;
  errorCode?: string;
}

export interface ReviewSummary {
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  autoFixedCount: number;
  suggestedFixCount: number;
}

export type ReviewStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed";

export interface CombinedReport {
  reviewId: string;
  status: ReviewStatus;
  repositoryFullName?: string;
  pullRequestNumber?: number;
  headSha?: string;
  confidenceThreshold?: Confidence;
  summary: ReviewSummary;
  /** De-duplicated and ranked by severity, then by confidence (FR-ORC-03, FR-ORC-04). */
  findings: Finding[];
  agentRuns: AgentRunSummary[];
  durationMs?: number;
  completedAt?: string;
}
