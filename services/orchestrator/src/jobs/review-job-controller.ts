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
  private readonly inFlight = new Map<string, AbortController>();

  constructor(deps: ReviewJobControllerDeps) {
    this.run = deps.run;
    this.store = deps.store;
    this.logger = deps.logger;
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? randomUUID;
  }

  createJob(request: ReviewJobRequest, options: CreateJobOptions = {}): CreatedJob {
    const { idempotencyKey, requestId } = options;
    if (idempotencyKey !== undefined) {
      const existing = this.store.findByIdempotencyKey(idempotencyKey);
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
    this.store.insert(job, idempotencyKey);
    this.execute(job, request, requestId).catch((error: unknown) => {
      this.logger.error("review job bookkeeping failed", { jobId: job.jobId, requestId, error });
    });
    return { job, created: true };
  }

  getJob(jobId: string): ReviewJob | undefined {
    return this.store.get(jobId);
  }

  /** Stops the run and its agent calls (NFR-14). A job that already finished is returned as is. */
  cancelJob(jobId: string): ReviewJob | undefined {
    const job = this.store.get(jobId);
    if (!job || isTerminal(job.status)) return job;

    const cancelled: ReviewJob = { ...job, status: "cancelled", completedAt: this.timestamp() };
    this.store.update(cancelled);
    this.inFlight.get(jobId)?.abort(new Error(`Review job ${jobId} cancelled`));
    return cancelled;
  }

  private async execute(job: ReviewJob, request: ReviewJobRequest, requestId: string | undefined): Promise<void> {
    const controller = new AbortController();
    this.inFlight.set(job.jobId, controller);
    this.store.update({ ...job, status: "running", startedAt: this.timestamp() });
    const log = { jobId: job.jobId, reviewId: job.reviewId, requestId };

    try {
      const report = await this.run(
        { reviewId: job.reviewId, request, ...(requestId !== undefined ? { requestId } : {}) },
        { signal: controller.signal },
      );
      this.finish(job.jobId, (current) => ({
        ...current,
        status: report.status,
        agentRuns: report.agentRuns,
        report,
      }));
      this.logger.info("review job finished", { ...log, status: report.status });
    } catch (error) {
      if (controller.signal.aborted) return;
      this.logger.error("review job failed", { ...log, error });
      this.finish(job.jobId, (current) => ({
        ...current,
        status: "failed",
        error: { code: "internal_error", message: "The review could not be completed" },
      }));
    } finally {
      this.inFlight.delete(job.jobId);
    }
  }

  /** Writes the final state unless the job was cancelled meanwhile. */
  private finish(jobId: string, change: (current: ReviewJob) => ReviewJob): void {
    const current = this.store.get(jobId);
    if (!current || isTerminal(current.status)) return;
    this.store.update({ ...change(current), completedAt: this.timestamp() });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
