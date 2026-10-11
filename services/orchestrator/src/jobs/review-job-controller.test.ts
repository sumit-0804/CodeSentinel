import { describe, expect, it, vi } from "vitest";

import type { CombinedReport, ReviewJobRequest } from "@code-sentinel/contracts";
import { exampleCombinedReport, exampleReviewJobRequest } from "@code-sentinel/contracts/examples";
import { HttpError, noopLogger } from "@code-sentinel/service-kit";
import { captureLogger } from "@code-sentinel/service-kit/testing";
import type { ReviewRunOptions } from "../graph/review-graph.js";
import { InMemoryJobStore } from "./job-store.js";
import { ReviewJobController, type RunReview } from "./review-job-controller.js";

const NOW = new Date("2026-09-27T10:00:00.000Z");

/** A run the test settles by hand, so it can look at the job while it is still running. */
function deferredRun() {
  let resolve!: (report: CombinedReport) => void;
  let reject!: (error: unknown) => void;
  let options: ReviewRunOptions | undefined;
  const run = vi.fn<RunReview>((_input, opts) => {
    options = opts;
    return new Promise<CombinedReport>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  });
  return { run, resolve: (r: CombinedReport) => resolve(r), reject: (e: unknown) => reject(e), signal: () => options?.signal };
}

function controllerWith(run: RunReview, logger = noopLogger) {
  let ids = 0;
  return new ReviewJobController({
    run,
    logger,
    store: new InMemoryJobStore({ retentionMs: 3_600_000, now: () => NOW }),
    now: () => NOW,
    newId: () => `00000000-0000-4000-8000-00000000000${++ids}`,
  });
}

function request(overrides: Partial<ReviewJobRequest> = {}): ReviewJobRequest {
  return { ...exampleReviewJobRequest, ...overrides };
}

/** Lets the background run settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("ReviewJobController", () => {
  it("accepts a job as queued, runs it, and stores the report with the report's status", async () => {
    const { run, resolve } = deferredRun();
    const controller = controllerWith(run);

    const { job, created } = await controller.createJob(request(), { requestId: "req-1" });
    await settle();

    expect(created).toBe(true);
    expect(job).toEqual({ jobId: expect.any(String), reviewId: expect.any(String), status: "queued", createdAt: NOW.toISOString() });
    expect((await controller.getJob(job.jobId))?.status).toBe("running");
    expect(run).toHaveBeenCalledWith(
      { reviewId: job.reviewId, requestId: "req-1", request: request() },
      { signal: expect.any(AbortSignal) },
    );

    const report = { ...exampleCombinedReport, reviewId: job.reviewId, status: "partial" as const };
    resolve(report);
    await settle();

    await expect(controller.getJob(job.jobId)).resolves.toEqual({
      ...job,
      status: "partial",
      startedAt: NOW.toISOString(),
      completedAt: NOW.toISOString(),
      agentRuns: report.agentRuns,
      report,
    });
  });

  it("returns the existing job for a replayed idempotency key without a second run", async () => {
    const { run } = deferredRun();
    const controller = controllerWith(run);

    const first = await controller.createJob(request(), { idempotencyKey: "delivery-1" });
    const replay = await controller.createJob(request(), { idempotencyKey: "delivery-1" });
    await settle();

    expect(replay.created).toBe(false);
    expect(replay.job.jobId).toBe(first.job.jobId);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("returns the existing job for a new delivery of an already reviewed commit", async () => {
    const { run } = deferredRun();
    const controller = controllerWith(run);

    const first = await controller.createJob(request(), { idempotencyKey: "delivery-1" });
    const reopened = await controller.createJob(request(), { idempotencyKey: "delivery-2" });
    await settle();

    expect(reopened.created).toBe(false);
    expect(reopened.job.jobId).toBe(first.job.jobId);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("refuses a job with no enabled agents with 422 no_agents_enabled", async () => {
    const controller = controllerWith(deferredRun().run);

    const attempt = controller.createJob(request({ enabledAgents: [] }));

    await expect(attempt).rejects.toThrow(HttpError);
    await expect(attempt).rejects.toMatchObject({ status: 422, code: "no_agents_enabled" });
  });

  it("marks the job failed with internal_error and logs when the run throws", async () => {
    const { run, reject } = deferredRun();
    const { logger, lines } = captureLogger();
    const controller = controllerWith(run, logger);
    const { job } = await controller.createJob(request());
    await settle();

    reject(new Error("graph exploded"));
    await settle();

    await expect(controller.getJob(job.jobId)).resolves.toMatchObject({
      status: "failed",
      completedAt: NOW.toISOString(),
      error: { code: "internal_error" },
    });
    expect(lines.find((line) => line.message === "review job failed")?.error).toMatchObject({ message: "graph exploded" });
  });

  it("cancels a running job, aborts its run, and keeps it cancelled when the run settles", async () => {
    const { run, resolve, signal } = deferredRun();
    const controller = controllerWith(run);
    const { job } = await controller.createJob(request());
    await settle();

    const cancelled = await controller.cancelJob(job.jobId);
    resolve({ ...exampleCombinedReport, status: "completed" });
    await settle();

    expect(cancelled?.status).toBe("cancelled");
    expect(signal()?.aborted).toBe(true);
    const stored = await controller.getJob(job.jobId);
    expect(stored).toMatchObject({ status: "cancelled", completedAt: NOW.toISOString() });
    expect(stored?.report).toBeUndefined();
  });

  it("returns a finished job unchanged on cancel, and undefined for an unknown job", async () => {
    const { run, resolve } = deferredRun();
    const controller = controllerWith(run);
    const { job } = await controller.createJob(request());
    await settle();
    resolve({ ...exampleCombinedReport, status: "completed" });
    await settle();

    expect((await controller.cancelJob(job.jobId))?.status).toBe("completed");
    await expect(controller.cancelJob("unknown")).resolves.toBeUndefined();
  });

  it("warns that callbackUrl is not supported yet", async () => {
    const { logger, lines } = captureLogger();
    const controller = controllerWith(deferredRun().run, logger);

    await controller.createJob(request({ callbackUrl: "https://gateway.internal/callback" }));

    expect(lines.some((line) => line.level === "warn" && String(line.message).includes("callbackUrl"))).toBe(true);
  });
});
