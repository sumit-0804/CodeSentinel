import type { SimilarIssueLookup } from "../context/similar-issue-lookup.js";
import type { ReviewState } from "./review-state.js";

/**
 * `ContextNode`: attaches similar past issues from the organization's vectors to each finding
 * (FR-ORC-05). A no-op when no lookup is wired or the job opted out; lookup errors are already
 * swallowed per finding by `SimilarIssueLookup`, so this node never fails the review.
 */
export function createContextNode(lookup?: SimilarIssueLookup) {
  return async function context(state: ReviewState): Promise<Partial<ReviewState>> {
    if (!lookup || !state.includeSimilarPastIssues || !state.report) return {};

    const findings = await lookup.attach(state.report.findings, state.organizationId);
    return { report: { ...state.report, findings } };
  };
}
