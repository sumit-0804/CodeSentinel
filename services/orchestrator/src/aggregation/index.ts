import type { AgentRunSummary, CombinedReport, Finding, ReviewStatus } from "@code-sentinel/contracts";
import { FindingAggregator } from "./finding-aggregator.js";
import { SeverityRanker } from "./severity-ranker.js";
import { buildReviewSummary } from "./review-summary.js";

export { FindingAggregator } from "./finding-aggregator.js";
export { SeverityRanker } from "./severity-ranker.js";
export { buildReviewSummary } from "./review-summary.js";

export interface AggregateInput {
  reviewId: string;
  rawFindings: Finding[];
  agentRuns: AgentRunSummary[];
  status?: ReviewStatus;
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

  return {
    reviewId: input.reviewId,
    status: input.status ?? "completed",
    summary: buildReviewSummary(findings),
    findings,
    agentRuns: input.agentRuns,
  };
}
