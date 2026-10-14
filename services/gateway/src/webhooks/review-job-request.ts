import type { ReviewJobRequestInput, ReviewTrigger } from "@code-sentinel/contracts";

import type { EffectiveRepositoryConfig, RepositoryRecord } from "../persistence/stores.js";
import type { FilteredFiles } from "./file-filter.js";
import type { PullRequestEvent } from "./github-payload.js";

/** The pull request a review covers, from a webhook payload or from GitHub's API. */
export interface PullRequestToReview {
  number: number;
  title: string;
  headSha: string;
  baseSha: string;
  headRef: string;
  baseRef: string;
}

export const pullRequestFromEvent = (event: PullRequestEvent): PullRequestToReview => ({
  number: event.number,
  title: event.pull_request.title,
  headSha: event.pull_request.head.sha,
  baseSha: event.pull_request.base.sha,
  headRef: event.pull_request.head.ref,
  baseRef: event.pull_request.base.ref,
});

export interface BuildReviewJobRequestInput {
  repository: RepositoryRecord;
  config: EffectiveRepositoryConfig;
  pullRequest: PullRequestToReview;
  filtered: FilteredFiles;
  /** `github_pull_request` for a webhook; `dashboard_manual` for a re-run, with the user who asked. */
  trigger?: Extract<ReviewTrigger, "github_pull_request" | "dashboard_manual">;
  triggeredByUserId?: string;
}

/** The orchestrator job for a pull request, carrying the tenant ids on every job (NFR-13). */
export function buildReviewJobRequest({
  repository,
  config,
  pullRequest,
  filtered,
  trigger = "github_pull_request",
  triggeredByUserId,
}: BuildReviewJobRequestInput): ReviewJobRequestInput {
  return {
    repositoryId: repository.repositoryId,
    organizationId: repository.organizationId,
    trigger,
    ...(triggeredByUserId ? { triggeredByUserId } : {}),
    pullRequest: {
      number: pullRequest.number,
      title: pullRequest.title,
      headRef: pullRequest.headRef,
      baseRef: pullRequest.baseRef,
    },
    headSha: pullRequest.headSha,
    baseSha: pullRequest.baseSha,
    files: filtered.files,
    ...(filtered.skippedFiles.length > 0 ? { skippedFiles: filtered.skippedFiles } : {}),
    enabledAgents: config.enabledAgents,
    confidenceThreshold: config.confidenceThreshold,
    agentTimeoutMs: config.agentTimeoutMs,
  };
}
