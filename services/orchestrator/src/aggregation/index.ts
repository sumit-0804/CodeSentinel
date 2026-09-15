import type {
  AgentRunSummary,
  CombinedReport,
  Finding,
  ReportSkippedFile,
  ReviewStatus,
} from "@code-sentinel/contracts";
import { FindingAggregator } from "./finding-aggregator.js";
import { SeverityRanker } from "./severity-ranker.js";
import { buildReviewSummary } from "./review-summary.js";

export { FindingAggregator } from "./finding-aggregator.js";
export { SeverityRanker } from "./severity-ranker.js";
export { buildReviewSummary } from "./review-summary.js";
export { mergeSkippedFiles, type AgentSkippedFiles } from "./skipped-files.js";

export interface AggregateInput {
  reviewId: string;
  rawFindings: Finding[];
  agentRuns: AgentRunSummary[];
  /** Defaults to `deriveStatus(agentRuns)`. */
  status?: ReviewStatus;
  /** Included on the report only when non-empty. */
  skippedFiles?: ReportSkippedFile[];
}

/**
 * The review status implied by the agent runs (`state_review.mmd`, FR-ORC-02, AC-12):
 * `completed` when every agent that ran succeeded, `partial` when at least one succeeded and
 * another timed out or failed, `failed` when none succeeded. `skipped` runs (agent not
 * configured) do not by themselves make a review partial.
 */
export function deriveStatus(agentRuns: AgentRunSummary[]): ReviewStatus {
  const succeeded = agentRuns.some((run) => run.status === "succeeded");
  if (!succeeded) return "failed";

  const missing = agentRuns.some((run) => run.status === "timed_out" || run.status === "failed");
  return missing ? "partial" : "completed";
}

/**
 * The aggregation step of the review graph (`AggregateNode` in the class diagram): take the raw
 * findings collected from the fan-out, de-duplicate them, rank by severity, and roll up the
 * summary counts into a `CombinedReport`.
 *
 * Context lookup (similar past issues) and the confidence-threshold pass run as separate nodes
 * after this one.
 */
export function aggregate(input: AggregateInput): CombinedReport {
  const deduped = new FindingAggregator().dedupe(input.rawFindings);
  const findings = new SeverityRanker().rank(deduped);

  const report: CombinedReport = {
    reviewId: input.reviewId,
    status: input.status ?? deriveStatus(input.agentRuns),
    summary: buildReviewSummary(findings),
    findings,
    agentRuns: input.agentRuns,
  };
  if (input.skippedFiles?.length) report.skippedFiles = input.skippedFiles;
  return report;
}
