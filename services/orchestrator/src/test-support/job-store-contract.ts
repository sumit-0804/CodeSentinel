import { randomBytes, randomInt, randomUUID } from "node:crypto";

import type { ReviewJob, ReviewJobRequest } from "@code-sentinel/contracts";
import { exampleCombinedReport, exampleReviewJobRequest } from "@code-sentinel/contracts/examples";
import { describe, expect, it } from "vitest";

import { ORPHANED_ERROR, type JobStore } from "../jobs/job-store.js";

export interface JobStoreHarness {
  store: JobStore;
  /** A valid request for a repository the store accepts; each call gets a fresh pull request commit. */
  request: (overrides?: Partial<ReviewJobRequest>) => ReviewJobRequest;
}

/** A pull request request with a random PR number and head SHA, so runs never collide. */
export function freshRequest(base: Partial<ReviewJobRequest> = {}, overrides: Partial<ReviewJobRequest> = {}): ReviewJobRequest {
  return {
    ...exampleReviewJobRequest,
    ...base,
    pullRequest: { ...exampleReviewJobRequest.pullRequest, number: randomInt(1, 1_000_000) },
    headSha: randomBytes(20).toString("hex"),
    ...overrides,
  };
}

export function queuedJob(overrides: Partial<ReviewJob> = {}): ReviewJob {
  return { jobId: randomUUID(), reviewId: randomUUID(), status: "queued", createdAt: "2026-10-11T10:00:00.000Z", ...overrides };
}

/** The behaviour every `JobStore` must share. */
export function describeJobStoreContract(setup: () => Promise<JobStoreHarness>): void {
  it("stores a queued job and misses an unknown one", async () => {
    const { store, request } = await setup();
    const job = queuedJob();

    await expect(store.insert(job, request())).resolves.toEqual({ job, created: true });
    await expect(store.get(job.jobId)).resolves.toEqual(job);
    await expect(store.get(randomUUID())).resolves.toBeUndefined();
  });

  it("returns the existing job for a repeated idempotency key", async () => {
    const { store, request } = await setup();
    const key = `delivery-${randomUUID()}`;
    const first = queuedJob();
    await store.insert(first, request(), key);

    await expect(store.insert(queuedJob(), request(), key)).resolves.toEqual({ job: first, created: false });
    await expect(store.findByIdempotencyKey(key)).resolves.toEqual(first);
    await expect(store.findByIdempotencyKey(`delivery-${randomUUID()}`)).resolves.toBeUndefined();
  });

  it("returns the existing job for the same pull request commit, but not for manual reviews", async () => {
    const { store, request } = await setup();
    const prRequest = request();
    const first = queuedJob();
    await store.insert(first, prRequest);

    await expect(store.insert(queuedJob(), { ...prRequest })).resolves.toEqual({ job: first, created: false });

    const manual = request({ trigger: "dashboard_manual" });
    await expect(store.insert(queuedJob(), manual)).resolves.toMatchObject({ created: true });
    await expect(store.insert(queuedJob(), { ...manual })).resolves.toMatchObject({ created: true });
  });

  it("marks a job running", async () => {
    const { store, request } = await setup();
    const job = queuedJob();
    await store.insert(job, request());

    await store.markRunning(job.jobId, "2026-10-11T10:00:01.000Z");

    await expect(store.get(job.jobId)).resolves.toEqual({ ...job, status: "running", startedAt: "2026-10-11T10:00:01.000Z" });
  });

  it("records each agent as it answers while running, in parallel without losing any, and stops once finished", async () => {
    const { store, request } = await setup();
    const job = queuedJob();
    await store.insert(job, request());
    const agents = ["security", "style", "performance", "logic", "documentation"] as const;

    await store.recordAgentRun(job.jobId, { agent: "security", status: "succeeded" });
    expect((await store.get(job.jobId))?.agentRuns).toBeUndefined();

    await store.markRunning(job.jobId, "2026-10-11T10:00:01.000Z");
    await Promise.all(agents.map((agent, i) => store.recordAgentRun(job.jobId, { agent, status: "succeeded", findingsCount: i, latencyMs: 100 * i })));
    const running = await store.get(job.jobId);
    expect(running?.agentRuns?.map((run) => run.agent).sort()).toEqual([...agents].sort());
    expect(running?.agentRuns?.find((run) => run.agent === "logic")).toEqual({ agent: "logic", status: "succeeded", findingsCount: 3, latencyMs: 300 });

    const report = { ...exampleCombinedReport, reviewId: job.reviewId };
    await store.complete({ ...job, status: report.status, startedAt: "2026-10-11T10:00:01.000Z", completedAt: "2026-10-11T10:00:09.000Z", agentRuns: report.agentRuns, report });
    await store.recordAgentRun(job.jobId, { agent: "style", status: "failed" });
    // The report supersedes the progress.
    expect((await store.get(job.jobId))?.agentRuns).toEqual(report.agentRuns);
  });

  it("completes an active job with its report", async () => {
    const { store, request } = await setup();
    const job = queuedJob();
    await store.insert(job, request());
    await store.markRunning(job.jobId, "2026-10-11T10:00:01.000Z");
    const report = { ...exampleCombinedReport, reviewId: job.reviewId };
    const done: ReviewJob = {
      ...job,
      status: report.status,
      startedAt: "2026-10-11T10:00:01.000Z",
      completedAt: "2026-10-11T10:00:09.000Z",
      agentRuns: report.agentRuns,
      report,
    };

    await expect(store.complete(done)).resolves.toBe(true);
    await expect(store.get(job.jobId)).resolves.toEqual(done);
  });

  it("never overwrites a job that already finished", async () => {
    const { store, request } = await setup();
    const job = queuedJob();
    await store.insert(job, request());
    const cancelled: ReviewJob = { ...job, status: "cancelled", completedAt: "2026-10-11T10:00:02.000Z" };
    await store.complete(cancelled);

    const late: ReviewJob = { ...job, status: "failed", completedAt: "2026-10-11T10:00:03.000Z", error: { code: "internal_error", message: "late" } };
    await expect(store.complete(late)).resolves.toBe(false);
    await expect(store.get(job.jobId)).resolves.toEqual(cancelled);
  });

  describe("failOrphaned", () => {
    it("fails queued and running jobs and leaves finished ones alone", async () => {
      const { store, request } = await setup();
      const queued = queuedJob();
      const running = queuedJob();
      const finished = queuedJob();
      for (const job of [queued, running, finished]) await store.insert(job, request());
      await store.markRunning(running.jobId, "2026-10-11T10:00:01.000Z");
      const cancelled: ReviewJob = { ...finished, status: "cancelled", completedAt: "2026-10-11T10:00:02.000Z" };
      await store.complete(cancelled);

      // At least ours: a shared database may hold other active jobs too.
      await expect(store.failOrphaned("2026-10-11T10:05:00.000Z")).resolves.toBeGreaterThanOrEqual(2);

      for (const job of [queued, running]) {
        await expect(store.get(job.jobId)).resolves.toMatchObject({
          status: "failed",
          completedAt: "2026-10-11T10:05:00.000Z",
          error: ORPHANED_ERROR,
        });
      }
      await expect(store.get(finished.jobId)).resolves.toEqual(cancelled);
    });
  });
}
