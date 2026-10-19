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
});
