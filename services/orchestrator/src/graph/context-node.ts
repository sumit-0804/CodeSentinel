import { randomUUID } from "node:crypto";

import type { SimilarIssueLookup } from "../context/similar-issue-lookup.js";
import type { ReviewState } from "./review-state.js";

/**
 * `ContextNode`: gives every finding its id (the `findings` row uses the same one), then attaches
 * similar past issues from the organization's vectors (FR-ORC-05). Lookup errors are swallowed per
 * finding by `SimilarIssueLookup`, so this node never fails the review.
 */
export function createContextNode(lookup?: SimilarIssueLookup) {
  return async function context(state: ReviewState): Promise<Partial<ReviewState>> {
    if (!state.report) return {};

    const withIds = state.report.findings.map((finding) => (finding.id ? finding : { ...finding, id: randomUUID() }));
    const findings =
      lookup && state.includeSimilarPastIssues
        ? await lookup.attach(withIds, {
            organizationId: state.organizationId,
            reviewId: state.reviewId,
            confidenceThreshold: state.confidenceThreshold,
          })
        : withIds;
    return { report: { ...state.report, findings } };
  };
}
