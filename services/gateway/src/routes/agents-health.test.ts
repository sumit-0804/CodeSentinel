import { AgentsHealthSchema } from "@code-sentinel/contracts";
import { withServer } from "@code-sentinel/service-kit/testing";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import { fakeOrchestrator, seededStores, testAppDeps, TEST_USER_ID } from "../test-support/fixtures.js";
import { testSupabase } from "../test-support/supabase-tokens.js";

async function setup(agentsHealth: ReturnType<typeof fakeOrchestrator>["agentsHealth"]) {
  const seeded = await seededStores();
  const supabase = await testSupabase();
  let clock = Date.parse("2026-10-19T10:00:00.000Z");
  const orchestrator = fakeOrchestrator({ agentsHealth: vi.fn(agentsHealth) });
  const app = createApp(testAppDeps({ stores: seeded.stores, supabaseVerifier: supabase.verifier, orchestrator, now: () => new Date(clock) }));
  const headers = { Authorization: `Bearer ${await supabase.sign(TEST_USER_ID)}` };
  return { app, orchestrator, headers, advance: (ms: number) => (clock += ms) };
}

describe("GET /v1/agents/health", () => {
  it("relays the orchestrator's check, reusing it for 15 seconds", async () => {
    const { app, orchestrator, headers, advance } = await setup(async () => ({
      checkedAt: "2026-10-19T09:59:58.000Z",
      agents: [
        { agent: "security", status: "ok", latencyMs: 12, version: "1.0.0" },
        { agent: "logic", status: "unavailable" },
      ],
    }));

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/agents/health`, { headers });
      expect(AgentsHealthSchema.parse(await response.json())).toEqual({
        checkedAt: "2026-10-19T09:59:58.000Z",
        agents: [
          { agent: "security", status: "ok", latencyMs: 12 },
          { agent: "logic", status: "unavailable" },
        ],
      });
      await fetch(`${baseUrl}/v1/agents/health`, { headers });
      expect(orchestrator.agentsHealth).toHaveBeenCalledTimes(1);

      advance(15_000);
      await fetch(`${baseUrl}/v1/agents/health`, { headers });
      expect(orchestrator.agentsHealth).toHaveBeenCalledTimes(2);

      expect((await fetch(`${baseUrl}/v1/agents/health`)).status).toBe(401);
    });
  });

  it("answers unknown for every agent when the orchestrator doesn't", async () => {
    const { app, headers } = await setup(async () => {
      throw new Error("connect ECONNREFUSED");
    });

    await withServer(app, async (baseUrl) => {
      const body = AgentsHealthSchema.parse(await (await fetch(`${baseUrl}/v1/agents/health`, { headers })).json());
      expect(body.checkedAt).toBeUndefined();
      expect(body.agents.map((a) => a.status)).toEqual(["unknown", "unknown", "unknown", "unknown", "unknown"]);
    });
  });
});
