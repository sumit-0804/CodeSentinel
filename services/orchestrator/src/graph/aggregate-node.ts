import { aggregate, deriveStatus, mergeSkippedFiles } from "../aggregation/index.js";
import type { ReviewState } from "./review-state.js";

/**
 * `AggregateNode`: de-duplicates and ranks the fan-out's raw findings (FR-ORC-03, FR-ORC-04),
 * derives the review status from the agent runs, and merges gateway and agent skips.
 */
export function aggregateNode(state: ReviewState): Partial<ReviewState> {
  const report = aggregate({
    reviewId: state.reviewId,
    rawFindings: state.rawFindings,
    agentRuns: state.agentRuns,
    status: deriveStatus(state.agentRuns),
    skippedFiles: mergeSkippedFiles(state.gatewaySkippedFiles, state.agentSkippedFiles),
  });
  return { report };
}
