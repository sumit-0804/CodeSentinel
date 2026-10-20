import { exampleCombinedReport } from "@code-sentinel/contracts/examples";
import { describe, expect, it } from "vitest";

import { createOrchestratorMetrics } from "./metrics.js";

describe("createOrchestratorMetrics", () => {
  it("counts agent runs and lookups, and reads each quota budget when scraped", async () => {
    let share = 0.42;
    const metrics = createOrchestratorMetrics([{ provider: "groq", account: "cara", budget: { remainingShare: () => share } }]);

    metrics.recordReport({
      ...exampleCombinedReport,
      agentRuns: [
        { agent: "security", status: "succeeded", latencyMs: 1200 },
        { agent: "logic", status: "timed_out" },
      ],
    });
    metrics.recordLookup("found");
    metrics.recordLookup("failed");

    const text = await metrics.registry.metrics();
    expect(text).toContain('agent_runs_total{agent="security",status="succeeded",service="orchestrator"} 1');
    expect(text).toContain('agent_runs_total{agent="logic",status="timed_out",service="orchestrator"} 1');
    expect(text).toContain('agent_latency_seconds_sum{service="orchestrator",agent="security"} 1.2');
    expect(text).toContain('vector_lookups_total{outcome="failed",service="orchestrator"} 1');
    expect(text).toContain('llm_quota_remaining_ratio{provider="groq",account="cara",service="orchestrator"} 0.42');

    share = 0.1;
    expect(await metrics.registry.metrics()).toContain('llm_quota_remaining_ratio{provider="groq",account="cara",service="orchestrator"} 0.1');
  });

  it("starts every agent and status at 0, so the first failure shows up in increase()", async () => {
    const text = await createOrchestratorMetrics().registry.metrics();

    expect(text).toContain('agent_runs_total{agent="security",status="failed",service="orchestrator"} 0');
    expect(text).toContain('agent_runs_total{agent="documentation",status="timed_out",service="orchestrator"} 0');
  });

  it("exposes the last health check per agent, asleep apart from down, and only the current status", async () => {
    const metrics = createOrchestratorMetrics();
    expect(await metrics.registry.metrics()).not.toMatch(/^agent_health\{/m);

    metrics.recordHealth({
      checkedAt: "2026-10-20T15:00:00.000Z",
      agents: [
        { agent: "security", status: "ok" },
        { agent: "logic", status: "unavailable", asleep: true },
        { agent: "style", status: "unavailable" },
      ],
    });
    const first = await metrics.registry.metrics();
    expect(first).toContain('agent_health{agent="security",status="ok",service="orchestrator"} 1');
    expect(first).toContain('agent_health{agent="logic",status="asleep",service="orchestrator"} 1');
    expect(first).toContain('agent_health{agent="style",status="unavailable",service="orchestrator"} 1');
    expect(first).toContain(`agent_health_checked_timestamp_seconds{service="orchestrator"} ${Date.parse("2026-10-20T15:00:00.000Z") / 1000}`);

    metrics.recordHealth({ checkedAt: "2026-10-20T15:01:00.000Z", agents: [{ agent: "logic", status: "ok" }] });
    const second = await metrics.registry.metrics();
    expect(second).toContain('agent_health{agent="logic",status="ok",service="orchestrator"} 1');
    expect(second).not.toContain('status="asleep"');
  });
});
