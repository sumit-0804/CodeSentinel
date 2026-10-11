import { HealthSchema } from "@code-sentinel/contracts";
import { withServer } from "@code-sentinel/service-kit/testing";
import express from "express";
import { describe, expect, it } from "vitest";

import { createHealthzRouter, type HealthzRouterDeps } from "./healthz.js";

async function healthz(deps: HealthzRouterDeps) {
  let body: unknown;
  await withServer(express().use(createHealthzRouter(deps)), async (baseUrl) => {
    body = HealthSchema.parse(await (await fetch(`${baseUrl}/healthz`)).json());
  });
  return body;
}

describe("GET /healthz", () => {
  it("reports the database when reviews are stored in Postgres", async () => {
    await expect(healthz({ version: "1.0.0", database: { ping: async () => 1 } })).resolves.toEqual({
      status: "ok",
      version: "1.0.0",
      checks: { database: "ok" },
    });
  });

  it("is degraded when the database is unreachable or hangs", async () => {
    const down = healthz({
      version: "1.0.0",
      database: {
        ping: async () => {
          throw new Error("Can't reach database server");
        },
      },
    });
    const hanging = healthz({ version: "1.0.0", database: { ping: () => new Promise(() => {}) }, databaseTimeoutMs: 20 });

    await expect(down).resolves.toMatchObject({ status: "degraded", checks: { database: "unavailable" } });
    await expect(hanging).resolves.toMatchObject({ status: "degraded", checks: { database: "unavailable" } });
  });
});
