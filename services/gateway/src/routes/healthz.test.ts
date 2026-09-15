import { GatewayHealthSchema } from "@code-sentinel/contracts";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { OrchestratorCallError } from "../orchestrator/orchestrator-call-error.js";
import type { OrchestratorClientLike } from "../orchestrator/orchestrator-client.js";
import { fakeOrchestrator, testAppDeps } from "../test-support/fixtures.js";
import { withServer } from "../test-support/with-server.js";

async function healthz(health: OrchestratorClientLike["health"]) {
  const app = createApp(testAppDeps({ orchestrator: fakeOrchestrator({ health }), version: "1.2.3" }));
  let result!: { status: number; body: unknown };
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    result = { status: response.status, body: GatewayHealthSchema.parse(await response.json()) };
  });
  return result;
}

describe("GET /healthz", () => {
  it("answers ok when the orchestrator is ok", async () => {
    const { status, body } = await healthz(async () => ({ status: "ok", version: "0.1.0" }));

    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok", version: "1.2.3", dependencies: { orchestrator: "ok" } });
  });

  it("answers degraded when the orchestrator is unreachable", async () => {
    const { status, body } = await healthz(async () => {
      throw new OrchestratorCallError("unreachable", { kind: "network", latencyMs: 1 });
    });

    expect(status).toBe(200);
    expect(body).toEqual({ status: "degraded", version: "1.2.3", dependencies: { orchestrator: "unavailable" } });
  });

  it("passes on a degraded orchestrator status", async () => {
    const { status, body } = await healthz(async () => ({ status: "degraded" }));

    expect(status).toBe(200);
    expect(body).toEqual({ status: "degraded", version: "1.2.3", dependencies: { orchestrator: "degraded" } });
  });
});
