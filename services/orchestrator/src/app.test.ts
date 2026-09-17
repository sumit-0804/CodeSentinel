import { describe, expect, it, vi } from "vitest";

import {
  AgentHealthSnapshotSchema,
  ApiErrorSchema,
  HealthSchema,
  ReviewJobSchema,
  type CombinedReport,
  type Health,
} from "@code-sentinel/contracts";
import { exampleCombinedReport, exampleReviewJobRequest } from "@code-sentinel/contracts/examples";
import { noopLogger } from "@code-sentinel/service-kit";
import { withServer } from "@code-sentinel/service-kit/testing";
import { AgentCallError } from "./agents/agent-call-error.js";
import { createApp } from "./app.js";
import { InMemoryJobStore } from "./jobs/job-store.js";
import { ReviewJobController, type RunReview } from "./jobs/review-job-controller.js";
import type { HealthClients } from "./routes/agents-health.js";

const TOKEN = "test-service-token";
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const JSON_AUTH = { ...AUTH, "Content-Type": "application/json" };

/** A run that never settles unless the test says so, so jobs stay `running`. */
function pendingRun() {
  let resolve!: (report: CombinedReport) => void;
  const run = vi.fn<RunReview>(() => new Promise<CombinedReport>((res) => (resolve = res)));
  return { run, resolve: (report: CombinedReport) => resolve(report) };
}

function testApp({ run = pendingRun().run, health = {} as HealthClients } = {}) {
  const controller = new ReviewJobController({
    run,
    logger: noopLogger,
    store: new InMemoryJobStore({ retentionMs: 3_600_000 }),
  });
  return createApp({ serviceToken: TOKEN, logger: noopLogger, controller, agentsHealth: { clients: health }, version: "test" });
}

async function send(baseUrl: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const postJob = (baseUrl: string, body: unknown = exampleReviewJobRequest, headers: Record<string, string> = {}) =>
  send(baseUrl, "/internal/v1/review-jobs", { method: "POST", headers: { ...JSON_AUTH, ...headers }, body: JSON.stringify(body) });

describe("orchestrator app", () => {
  it("accepts a job with 202, polls it, and serves the report once the run finishes", async () => {
    const { run, resolve } = pendingRun();
    await withServer(testApp({ run }), async (baseUrl) => {
      const created = await postJob(baseUrl, exampleReviewJobRequest, { "X-Request-Id": "req-7" });
      expect(created.status).toBe(202);
      const job = ReviewJobSchema.parse(created.body);
      expect(job.status).toBe("queued");
      expect(run.mock.calls[0]?.[0]).toMatchObject({ reviewId: job.reviewId, requestId: "req-7" });

      const running = await send(baseUrl, `/internal/v1/review-jobs/${job.jobId}`, { headers: AUTH });
      expect(ReviewJobSchema.parse(running.body).status).toBe("running");

      resolve({ ...exampleCombinedReport, reviewId: job.reviewId, status: "completed" });
      await new Promise((r) => setImmediate(r));
      const done = ReviewJobSchema.parse((await send(baseUrl, `/internal/v1/review-jobs/${job.jobId}`, { headers: AUTH })).body);
      expect(done.status).toBe("completed");
      expect(done.report?.reviewId).toBe(job.reviewId);
    });
  });

  it("answers a replayed Idempotency-Key with 200 and the same job", async () => {
    await withServer(testApp(), async (baseUrl) => {
      const first = await postJob(baseUrl, exampleReviewJobRequest, { "Idempotency-Key": "delivery-1" });
      const replay = await postJob(baseUrl, exampleReviewJobRequest, { "Idempotency-Key": "delivery-1" });

      expect(first.status).toBe(202);
      expect(replay.status).toBe(200);
      expect(ReviewJobSchema.parse(replay.body).jobId).toBe(first.body.jobId);
    });
  });

  it("rejects an invalid body with 400 invalid_body and a bad Idempotency-Key with 400 invalid_header", async () => {
    await withServer(testApp(), async (baseUrl) => {
      const invalid = await postJob(baseUrl, { ...exampleReviewJobRequest, files: [] });
      const badKey = await postJob(baseUrl, exampleReviewJobRequest, { "Idempotency-Key": "x".repeat(201) });

      expect(invalid.status).toBe(400);
      expect(ApiErrorSchema.parse(invalid.body).code).toBe("invalid_body");
      expect(badKey.status).toBe(400);
      expect(badKey.body.code).toBe("invalid_header");
    });
  });

  it("answers 422 no_agents_enabled when the job enables no agent", async () => {
    await withServer(testApp(), async (baseUrl) => {
      const { status, body } = await postJob(baseUrl, { ...exampleReviewJobRequest, enabledAgents: [] });

      expect(status).toBe(422);
      expect(body.code).toBe("no_agents_enabled");
    });
  });

  it("requires the service token on /internal routes", async () => {
    await withServer(testApp(), async (baseUrl) => {
      const missing = await send(baseUrl, "/internal/v1/review-jobs", { method: "POST" });
      const wrong = await send(baseUrl, "/internal/v1/agents/health", { headers: { Authorization: "Bearer nope" } });

      expect(missing.status).toBe(401);
      expect(missing.body.code).toBe("unauthenticated");
      expect(wrong.status).toBe(401);
      expect(wrong.body.code).toBe("invalid_credentials");
    });
  });

  it("answers 404 for an unknown job on poll and cancel", async () => {
    await withServer(testApp(), async (baseUrl) => {
      const poll = await send(baseUrl, "/internal/v1/review-jobs/unknown", { headers: AUTH });
      const cancel = await send(baseUrl, "/internal/v1/review-jobs/unknown/cancel", { method: "POST", headers: AUTH });

      expect(poll.status).toBe(404);
      expect(ApiErrorSchema.parse(poll.body).code).toBe("not_found");
      expect(cancel.status).toBe(404);
    });
  });

  it("cancels a running job", async () => {
    await withServer(testApp(), async (baseUrl) => {
      const { body } = await postJob(baseUrl);

      const cancel = await send(baseUrl, `/internal/v1/review-jobs/${String(body.jobId)}/cancel`, { method: "POST", headers: AUTH });

      expect(cancel.status).toBe(200);
      expect(ReviewJobSchema.parse(cancel.body).status).toBe("cancelled");
    });
  });

  it("serves /healthz without a token", async () => {
    await withServer(testApp(), async (baseUrl) => {
      const { status, body } = await send(baseUrl, "/healthz");

      expect(status).toBe(200);
      expect(HealthSchema.parse(body)).toEqual({ status: "ok", version: "test" });
    });
  });

  it("reports each agent's health, unavailable when unconfigured or unreachable, and caches it", async () => {
    const security = { health: vi.fn(async (): Promise<Health> => ({ status: "ok", version: "1.2.0" })) };
    const logic = {
      health: vi.fn(async (): Promise<Health> => {
        throw new AgentCallError("down", { agent: "logic", kind: "network", latencyMs: 1 });
      }),
    };
    await withServer(testApp({ health: { security, logic } }), async (baseUrl) => {
      const first = AgentHealthSnapshotSchema.parse((await send(baseUrl, "/internal/v1/agents/health", { headers: AUTH })).body);
      await send(baseUrl, "/internal/v1/agents/health", { headers: AUTH });

      expect(first.agents).toEqual([
        { agent: "security", status: "ok", latencyMs: expect.any(Number), version: "1.2.0" },
        { agent: "style", status: "unavailable" },
        { agent: "performance", status: "unavailable" },
        { agent: "logic", status: "unavailable" },
        { agent: "documentation", status: "unavailable" },
      ]);
      expect(security.health).toHaveBeenCalledTimes(1);
    });
  });
});
