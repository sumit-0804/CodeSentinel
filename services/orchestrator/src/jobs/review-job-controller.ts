import { randomUUID } from "node:crypto";

import type { CombinedReport, ReviewJob, ReviewJobRequest } from "@code-sentinel/contracts";
import { unprocessable, type Logger } from "@code-sentinel/service-kit";

import type { ReviewRunInput, ReviewRunOptions } from "../graph/review-graph.js";
import { isTerminal, type JobStore } from "./job-store.js";

/** `buildReviewGraph().run`, or a fake in tests. */
export type RunReview = (input: ReviewRunInput, options: ReviewRunOptions) => Promise<CombinedReport>;

export interface ReviewJobControllerDeps {
  run: RunReview;
  store: JobStore;
  logger: Logger;
  now?: () => Date;
  newId?: () => string;
  /** Runs in the background once a finished job is stored (not when a cancel won); errors are logged. */
  afterComplete?: (job: ReviewJob, request: ReviewJobRequest) => Promise<void>;
}

export interface CreateJobOptions {
  /** The GitHub delivery id for webhook reviews; a replay returns the existing job. */
  idempotencyKey?: string;
  /** Forwarded to every agent call (NFR-12). */
  requestId?: string;
}

export interface CreatedJob {
  job: ReviewJob;
  /** `false` when the idempotency key matched an existing job. */
  created: boolean;
}

/**
 * `ReviewJobController` from `class_orchestrator.mmd`: accepts a review job, runs the review graph
 * in the background, and answers polls and cancels from the job store.
 */
export class ReviewJobController {
  private readonly run: RunReview;
  private readonly store: JobStore;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly afterComplete: ReviewJobControllerDeps["afterComplete"];
  private readonly inFlight = new Map<string, AbortController>();

  constructor(deps: ReviewJobControllerDeps) {
    this.run = deps.run;
    this.store = deps.store;
    this.logger = deps.logger;
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? randomUUID;
    this.afterComplete = deps.afterComplete;
  }

  async createJob(request: ReviewJobRequest, options: CreateJobOptions = {}): Promise<CreatedJob> {
    const { idempotencyKey, requestId } = options;
    if (idempotencyKey !== undefined) {
      const existing = await this.store.findByIdempotencyKey(idempotencyKey);
      if (existing) return { job: existing, created: false };
    }
    if (request.enabledAgents?.length === 0) {
      throw unprocessable("no_agents_enabled", "No agents are enabled for this repository");
    }
    if (request.callbackUrl !== undefined) {
      this.logger.warn("callbackUrl is not supported yet; poll the job instead", { requestId });
    }

    const job: ReviewJob = {
      jobId: this.newId(),
      reviewId: this.newId(),
      status: "queued",
      createdAt: this.timestamp(),
    };
    // A concurrent delivery or an earlier review of the same pull request commit wins.
    const inserted = await this.store.insert(job, request, idempotencyKey);
    if (!inserted.created) return inserted;

    this.execute(job, request, requestId).catch((error: unknown) => {
      this.logger.error("review job bookkeeping failed", { jobId: job.jobId, requestId, error });
    });
    return { job, created: true };
  }

  getJob(jobId: string): Promise<ReviewJob | undefined> {
    return this.store.get(jobId);
  }

  /** Stops the run and its agent calls (NFR-14). A job that already finished is returned as is. */
  async cancelJob(jobId: string): Promise<ReviewJob | undefined> {
    const job = await this.store.get(jobId);
    if (!job || isTerminal(job.status)) return job;

    const cancelled: ReviewJob = { ...job, status: "cancelled", completedAt: this.timestamp() };
    // The run may have finished between the read and this write; then its result stands.
    if (!(await this.store.complete(cancelled))) return this.store.get(jobId);
    this.inFlight.get(jobId)?.abort(new Error(`Review job ${jobId} cancelled`));
    return cancelled;
  }

  private async execute(job: ReviewJob, request: ReviewJobRequest, requestId: string | undefined): Promise<void> {
    const controller = new AbortController();
    this.inFlight.set(job.jobId, controller);
    const startedAt = this.timestamp();
    const log = { jobId: job.jobId, reviewId: job.reviewId, requestId };

    try {
      await this.store.markRunning(job.jobId, startedAt);
      const report = await this.run(
        { reviewId: job.reviewId, request, ...(requestId !== undefined ? { requestId } : {}) },
        {
          signal: controller.signal,
          // Live progress for the dashboard; a failed write is logged and never fails the review.
          onAgentRun: (run) => {
            this.store.recordAgentRun(job.jobId, run).catch((error: unknown) => {
              this.logger.warn("agent progress not recorded", { ...log, agent: run.agent, error });
            });
          },
        },
      );
      await this.finish({ ...job, startedAt, status: report.status, agentRuns: report.agentRuns, report }, request);
      this.logger.info("review job finished", { ...log, status: report.status });
    } catch (error) {
      if (controller.signal.aborted) return;
      this.logger.error("review job failed", { ...log, error });
      await this.finish(
        { ...job, startedAt, status: "failed", error: { code: "internal_error", message: "The review could not be completed" } },
        request,
      );
    } finally {
      this.inFlight.delete(job.jobId);
    }
  }

  /** Writes the final state; the store ignores it if the job was cancelled meanwhile. */
  private async finish(job: ReviewJob, request: ReviewJobRequest): Promise<void> {
    const finished = { ...job, completedAt: this.timestamp() };
    if (!(await this.store.complete(finished, request)) || !this.afterComplete) return;
    this.afterComplete(finished, request).catch((error: unknown) => {
      this.logger.error("after-review step failed", { jobId: job.jobId, reviewId: job.reviewId, error });
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
