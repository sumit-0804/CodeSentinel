import type { ReviewState } from "./review-state.js";

/**
 * `ThresholdNode`: records the repository's confidence threshold on the report (FR-ORC-06).
 * Findings are not filtered or flagged here: `CombinedReport` has no per-finding `postable`
 * field, and the gateway applies the threshold when it decides which suggestions to post.
 */
export function thresholdNode(state: ReviewState): Partial<ReviewState> {
  if (!state.report) return {};
  return { report: { ...state.report, confidenceThreshold: state.confidenceThreshold } };
}
