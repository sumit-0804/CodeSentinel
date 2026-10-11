import { GatewayHealthSchema } from "@code-sentinel/contracts";
import { withServer } from "@code-sentinel/service-kit/testing";
import express, { type Express } from "express";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { OrchestratorCallError } from "../orchestrator/orchestrator-call-error.js";
import type { OrchestratorClientLike } from "../orchestrator/orchestrator-client.js";
import { fakeOrchestrator, testAppDeps } from "../test-support/fixtures.js";
import { createHealthzRouter, type DatabaseHealth } from "./healthz.js";

const ok: OrchestratorClientLike["health"] = async () => ({ status: "ok", version: "0.1.0" });

async function healthz(health: OrchestratorClientLike["health"], database?: DatabaseHealth) {
  return get(createApp(testAppDeps({ orchestrator: fakeOrchestrator({ health }), version: "1.2.3", ...(database ? { database } : {}) })));
}

async function get(app: Express) {
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

  it("reports the database when the gateway uses one", async () => {
    const { body } = await healthz(ok, { ping: async () => [{ "?column?": 1 }] });

    expect(body).toEqual({ status: "ok", version: "1.2.3", dependencies: { orchestrator: "ok", database: "ok" } });
  });

  it("answers degraded when the database is unreachable", async () => {
    const { status, body } = await healthz(ok, {
      ping: async () => {
        throw new Error("Can't reach database server");
      },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ status: "degraded", version: "1.2.3", dependencies: { orchestrator: "ok", database: "unavailable" } });
  });

  it("counts a database ping that hangs as unavailable", async () => {
    const router = createHealthzRouter({
      orchestrator: { health: ok },
      database: { ping: () => new Promise(() => {}) },
      version: "1.2.3",
      databaseTimeoutMs: 20,
    });

    const { body } = await get(express().use(router));

    expect(body).toMatchObject({ status: "degraded", dependencies: { database: "unavailable" } });
  });
});
