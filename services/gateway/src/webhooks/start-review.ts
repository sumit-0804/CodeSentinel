import type { ReviewJob, SkippedFile } from "@code-sentinel/contracts";
import type { Logger } from "@code-sentinel/service-kit";

import type { GitHubClient, PullRequestRef } from "../github/github-client.js";
import type { ReviewPublisher } from "../github/review-publisher.js";
import type { OrchestratorClientLike } from "../orchestrator/orchestrator-client.js";
import type { EffectiveRepositoryConfig, RepositoryRecord, Stores } from "../persistence/stores.js";
import { attachFileContents, DEFAULT_FILE_CONTENT_MAX_BYTES } from "./file-contents.js";
import { filterPullRequestFiles } from "./file-filter.js";
import { buildReviewJobRequest, type BuildReviewJobRequestInput, type PullRequestToReview } from "./review-job-request.js";

export interface StartReviewDeps {
  stores: Pick<Stores, "reviews">;
  github: Pick<GitHubClient, "listPullRequestFiles" | "getFileContent">;
  orchestrator: Pick<OrchestratorClientLike, "createReviewJob" | "cancelReviewJob">;
  logger: Logger;
  /** Posts the review back to the pull request; omitted in tests that do not publish. */
  publisher?: Pick<ReviewPublisher, "follow" | "nothingToReview">;
  /** Larger changed files go to the agents as diffs only (`FILE_CONTENT_MAX_BYTES`). */
  fileContentMaxBytes?: number;
}

export interface StartReviewInput {
  repository: RepositoryRecord;
  config: EffectiveRepositoryConfig;
  ref: PullRequestRef;
  pullRequest: PullRequestToReview;
  trigger: NonNullable<BuildReviewJobRequestInput["trigger"]>;
  triggeredByUserId?: string;
  /** The webhook's delivery id, or a fresh id for a re-run. */
  idempotencyKey: string;
  requestId: string;
  /** Filled with `files` and `skippedFiles` counts for the request log line. */
  logFields?: Record<string, unknown>;
}

export type StartReviewResult =
  | { outcome: "no_reviewable_files"; skippedFiles: SkippedFile[] }
  | { outcome: "review_started" | "duplicate_ignored"; job: ReviewJob };

/**
 * The shared path for a webhook and a dashboard re-run: list and filter the pull request's files,
 * then either post "Nothing to review" or start the job, cancel the older review it replaces and
 * follow it to GitHub. The follow-ups run in the background and never throw; an orchestrator
 * failure (`OrchestratorCallError`) is left to the caller.
 */
export async function startPullRequestReview(deps: StartReviewDeps, input: StartReviewInput): Promise<StartReviewResult> {
  const { stores, github, orchestrator, logger, publisher } = deps;
  const { repository, config, ref, pullRequest, requestId } = input;

  const filtered = filterPullRequestFiles(await github.listPullRequestFiles(ref));
  if (input.logFields) {
    input.logFields.files = filtered.files.length;
    input.logFields.skippedFiles = countByReason(filtered.skippedFiles);
  }
  // Nothing reaches the agents, but the pull request still gets a Check Run saying why.
  if (filtered.files.length === 0) {
    void publisher?.nothingToReview({ ref, headSha: pullRequest.headSha, skippedFiles: filtered.skippedFiles, requestId });
    return { outcome: "no_reviewable_files", skippedFiles: filtered.skippedFiles };
  }

  const files = await attachFileContents(github, {
    ref,
    headSha: pullRequest.headSha,
    files: filtered.files,
    maxBytes: deps.fileContentMaxBytes ?? DEFAULT_FILE_CONTENT_MAX_BYTES,
    logger,
    requestId,
  });
  const { job, created } = await orchestrator.createReviewJob(
    buildReviewJobRequest({
      repository,
      config,
      pullRequest,
      filtered: { ...filtered, files },
      trigger: input.trigger,
      ...(input.triggeredByUserId ? { triggeredByUserId: input.triggeredByUserId } : {}),
    }),
    { idempotencyKey: input.idempotencyKey, requestId },
  );
  // A redelivery: the first delivery already owns the Check Run and the review.
  if (!created) return { outcome: "duplicate_ignored", job };

  void cancelSuperseded({ stores, orchestrator, logger, repositoryId: repository.repositoryId, prNumber: pullRequest.number, keepReviewId: job.reviewId, requestId });
  void publisher?.follow({
    ref,
    headSha: pullRequest.headSha,
    jobId: job.jobId,
    reviewId: job.reviewId,
    requestId,
    threshold: config.confidenceThreshold,
    blockingAgents: config.blockingAgents,
    postInlineComments: config.postInlineComments,
  });
  return { outcome: "review_started", job };
}

/**
 * Cancels the pull request's other queued or running reviews, so only the newest one posts a
 * verdict; each cancelled one completes its Check Run as superseded. Never throws.
 */
export async function cancelSuperseded(input: {
  stores: Pick<Stores, "reviews">;
  orchestrator: Pick<OrchestratorClientLike, "cancelReviewJob">;
  logger: Logger;
  repositoryId: string;
  prNumber: number;
  keepReviewId: string;
  requestId: string;
}): Promise<void> {
  const { stores, orchestrator, logger, requestId } = input;
  try {
    const active = await stores.reviews.activeForPullRequest(input.repositoryId, input.prNumber);
    for (const review of active.filter((r) => r.reviewId !== input.keepReviewId)) {
      try {
        await orchestrator.cancelReviewJob(review.jobId, { requestId });
        logger.info("superseded review cancelled", { requestId, reviewId: review.reviewId, jobId: review.jobId });
      } catch (error) {
        logger.warn("could not cancel a superseded review", { requestId, reviewId: review.reviewId, error });
      }
    }
  } catch (error) {
    logger.warn("could not look up superseded reviews", { requestId, error });
  }
}

function countByReason(skippedFiles: { reason: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { reason } of skippedFiles) counts[reason] = (counts[reason] ?? 0) + 1;
  return counts;
}
