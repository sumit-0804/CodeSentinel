import express from "express";
import { describe, expect, it } from "vitest";

import { errorHandler, notFoundHandler } from "./http/error-handler.js";
import { requestIdMiddleware } from "./http/request-id.js";
import { noopLogger } from "./logging/logger.js";
import { Counter, createMetrics } from "./metrics.js";
import { withServer } from "./testing/with-server.js";

function app(token: string | undefined) {
  const metrics = createMetrics("test-service");
  const jobs = new Counter({ name: "jobs_total", help: "Jobs", labelNames: ["outcome"] as const, registers: [metrics.registry] });
  const server = express();
  server.use(requestIdMiddleware());
  server.use(metrics.httpMiddleware);
  server.use(metrics.router(token));
  server.get("/jobs/:id", (_req, res) => {
    jobs.inc({ outcome: "done" });
    res.json({ ok: true });
  });
  server.use(notFoundHandler());
  server.use(errorHandler(noopLogger));
  return server;
}

describe("createMetrics", () => {
  it("serves request durations by route pattern and the service's own series, behind the token", async () => {
    await withServer(app("metrics-token-123"), async (baseUrl) => {
      await fetch(`${baseUrl}/jobs/42`);
      await fetch(`${baseUrl}/jobs/43`);

      expect((await fetch(`${baseUrl}/metrics`)).status).toBe(401);
      expect((await fetch(`${baseUrl}/metrics`, { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);

      const response = await fetch(`${baseUrl}/metrics`, { headers: { Authorization: "Bearer metrics-token-123" } });
      const text = await response.text();
      expect(response.status).toBe(200);
      expect(text).toContain('http_request_duration_seconds_count{service="test-service",method="GET",route="/jobs/:id",status="200"} 2');
      expect(text).toContain('jobs_total{outcome="done",service="test-service"} 2');
      expect(text).toContain("process_cpu_seconds_total");
    });
  });

  it("doesn't mount /metrics without a token", async () => {
    await withServer(app(undefined), async (baseUrl) => {
      expect((await fetch(`${baseUrl}/metrics`)).status).toBe(404);
    });
  });
});
