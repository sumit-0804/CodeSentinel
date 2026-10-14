import type { AgentKind, CheckConclusion as StoredConclusion, ReviewJob, SkippedFile } from "@code-sentinel/contracts";
import type { Logger } from "@code-sentinel/service-kit";

import { OrchestratorCallError } from "../orchestrator/orchestrator-call-error.js";
import type { OrchestratorClientLike } from "../orchestrator/orchestrator-client.js";
import type { ReviewStore } from "../persistence/stores.js";
import { githubStatus, type CheckConclusion, type GitHubClient, type PullRequestRef, type ReviewComment } from "./github-client.js";
import { CHECK_NAME, checkRunConclusion, checkRunOutput, droppedComments, isTerminal, nothingToReviewOutput, reviewComments } from "./review-output.js";

/** `reviews.check_conclusion` uses its own words for GitHub's conclusions. */
const STORED_CONCLUSION: Record<CheckConclusion, StoredConclusion> = { success: "pass", failure: "fail", neutral: "neutral" };

export interface ReviewPublisherDeps {
  github: Pick<GitHubClient, "createCheckRun" | "completeCheckRun" | "createReview">;
  orchestrator: Pick<OrchestratorClientLike, "getReviewJob">;
  logger: Logger;
  /** Where the Check Run's conclusion is kept for the dashboard; omitted in tests that don't check it. */
  reviews?: Pick<ReviewStore, "recordCheckRun">;
  pollIntervalMs?: number;
  /** Give up waiting after this long and complete the Check Run as `neutral`. */
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface FollowInput {
  ref: PullRequestRef;
  headSha: string;
  jobId: string;
  reviewId: string;
  requestId: string;
  threshold: number;
  /** Agents in `block` mode; only their critical findings fail the Check Run. */
  blockingAgents: AgentKind[];
  postInlineComments: boolean;
}

/**
 * Posts a review back to its pull request (`seq_uc1_pr_review.mmd`, FR-GH-02/03): a Check Run in
 * progress at once (AC-01), then, when the job finishes, one `COMMENT` review with inline fixes and
 * the completed Check Run. Runs after the webhook has answered, so it never throws.
 */
export class ReviewPublisher {
  private readonly github: ReviewPublisherDeps["github"];
  private readonly orchestrator: ReviewPublisherDeps["orchestrator"];
  private readonly logger: Logger;
  private readonly reviews: ReviewPublisherDeps["reviews"];
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: ReviewPublisherDeps) {
    this.github = deps.github;
    this.orchestrator = deps.orchestrator;
    this.logger = deps.logger;
    this.reviews = deps.reviews;
    this.pollIntervalMs = deps.pollIntervalMs ?? 2_000;
    this.timeoutMs = deps.timeoutMs ?? 300_000;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async follow(input: FollowInput): Promise<void> {
    const log = this.logger.child({ requestId: input.requestId, reviewId: input.reviewId, jobId: input.jobId });
    try {
      await this.publish(input, log);
    } catch (error) {
      log.error("publishing the review to GitHub failed", { error });
    }
  }

  /** A neutral "Nothing to review" Check Run when every changed file was skipped; never throws. */
  async nothingToReview(input: { ref: PullRequestRef; headSha: string; skippedFiles: SkippedFile[]; requestId: string }): Promise<void> {
    const log = this.logger.child({ requestId: input.requestId });
    try {
      const checkRunId = await this.github.createCheckRun(input.ref, { name: CHECK_NAME, headSha: input.headSha });
      await this.github.completeCheckRun(input.ref, checkRunId, { conclusion: "neutral", output: nothingToReviewOutput(input.skippedFiles) });
      log.info("nothing-to-review Check Run posted", { checkRunId, skippedFiles: input.skippedFiles.length });
    } catch (error) {
      log.warn("could not post the nothing-to-review Check Run", { status: githubStatus(error), error });
    }
  }

  private async publish(input: FollowInput, log: Logger): Promise<void> {
    const { ref, headSha, threshold, blockingAgents } = input;
    let checkRunId: number | undefined;
    try {
      checkRunId = await this.github.createCheckRun(ref, { name: CHECK_NAME, headSha });
    } catch (error) {
      // Inline comments can still be posted without the Check Run.
      log.warn("could not create the Check Run", { status: githubStatus(error), error });
    }

    const job = await this.waitForJob(input.jobId, input.requestId, log);
    const notes: string[] = [];
    if (!job) {
      notes.push(`The review did not finish within ${Math.round(this.timeoutMs / 1000)} s.`);
    } else if (input.postInlineComments && job.status !== "cancelled") {
      notes.push(...(await this.postReview(ref, headSha, job, threshold, log)));
    }

    if (checkRunId === undefined) return;
    const conclusion = job ? checkRunConclusion(job, threshold, blockingAgents) : "neutral";
    const output = job
      ? checkRunOutput(job, threshold, blockingAgents, notes)
      : { title: "Review timed out", summary: notes.join("\n\n"), annotations: [] };
    await this.github.completeCheckRun(ref, checkRunId, { conclusion, output });
    log.info("review published to GitHub", { checkRunId, conclusion, annotations: output.annotations.length });
    try {
      await this.reviews?.recordCheckRun(input.reviewId, { checkRunId, conclusion: STORED_CONCLUSION[conclusion] });
    } catch (error) {
      // The Check Run is already on GitHub; only the dashboard's verdict is missing.
      log.warn("could not store the Check Run's conclusion", { checkRunId, error });
    }
  }

  /** Polls until the job is finished; undefined if it is still running at the deadline or gone. */
  private async waitForJob(jobId: string, requestId: string, log: Logger): Promise<ReviewJob | undefined> {
    const deadline = this.now() + this.timeoutMs;
    for (;;) {
      try {
        const job = await this.orchestrator.getReviewJob(jobId, { requestId });
        if (isTerminal(job)) return job;
      } catch (error) {
        if (error instanceof OrchestratorCallError && error.status === 404) {
          log.warn("review job no longer exists on the orchestrator", {});
          return undefined;
        }
        // The orchestrator may be restarting; keep trying until the deadline.
        log.warn("polling the review job failed", { error });
      }
      if (this.now() + this.pollIntervalMs > deadline) return undefined;
      await this.sleep(this.pollIntervalMs);
    }
  }

  /** One review with every comment; on a 422, each comment alone so one bad line loses only itself. */
  private async postReview(ref: PullRequestRef, headSha: string, job: ReviewJob, threshold: number, log: Logger): Promise<string[]> {
    const comments = reviewComments(job, threshold);
    const notes: string[] = [];
    const overflow = droppedComments(job, threshold);
    if (overflow) notes.push(`${overflow} more finding${overflow === 1 ? "" : "s"} not posted inline (limit ${comments.length}); see the annotations.`);
    if (!comments.length) return notes;

    const body = `Code-Sentinel posted ${comments.length} comment${comments.length === 1 ? "" : "s"}; the full report is on the **Code-Sentinel** check.`;
    try {
      await this.github.createReview(ref, { commitId: headSha, body, comments });
      log.info("review comments posted", { comments: comments.length });
      return notes;
    } catch (error) {
      if (githubStatus(error) !== 422) {
        log.error("could not post review comments", { status: githubStatus(error), error });
        return [...notes, "Inline comments could not be posted; the findings are in the annotations."];
      }
      log.warn("GitHub refused the review; posting comments one by one", { error });
    }

    const refused: ReviewComment[] = [];
    for (const comment of comments) {
      try {
        await this.github.createReview(ref, { commitId: headSha, body: "", comments: [comment] });
      } catch (error) {
        refused.push(comment);
        log.warn("GitHub refused a review comment", { path: comment.path, line: comment.line, status: githubStatus(error) });
      }
    }
    if (refused.length) {
      notes.push(`${refused.length} inline comment${refused.length === 1 ? "" : "s"} could not be placed on the diff: ${refused.map((c) => `\`${c.path}:${c.line}\``).join(", ")}.`);
    }
    return notes;
  }
}
