import { AgentKindSchema, AgentRunStatusSchema, type AgentHealthSnapshot, type CombinedReport } from "@code-sentinel/contracts";
import type { QuotaBudget } from "@code-sentinel/llm";
import { Counter, createMetrics, Gauge, Histogram } from "@code-sentinel/service-kit";

export type LookupOutcome = "found" | "none" | "failed";

/** One quota budget to watch, named by provider and, for Groq, the account it belongs to. */
export interface WatchedBudget {
  provider: string;
  account: string;
  budget: Pick<QuotaBudget, "remainingShare">;
}

/** The orchestrator's Prometheus series on top of the kit's request histogram (WP6). */
export function createOrchestratorMetrics(budgets: readonly WatchedBudget[] = []) {
  const metrics = createMetrics("orchestrator");
  const registers = [metrics.registry];

  const agentRuns = new Counter({ name: "agent_runs_total", help: "Agent runs by agent and status", labelNames: ["agent", "status"] as const, registers });
  // Every series starts at 0: one first seen at 1 hides its first run from increase(), so an alert would miss it.
  for (const agent of AgentKindSchema.options) {
    for (const status of AgentRunStatusSchema.options) agentRuns.inc({ agent, status }, 0);
  }
  const agentLatency = new Histogram({
    name: "agent_latency_seconds",
    help: "How long each agent took in a review",
    labelNames: ["agent"] as const,
    buckets: [0.5, 1, 2.5, 5, 10, 20, 30, 45, 60, 90],
    registers,
  });
  const vectorLookups = new Counter({
    name: "vector_lookups_total",
    help: "Similar-issue lookups by outcome",
    labelNames: ["outcome"] as const,
    registers,
  });
  new Gauge({
    name: "llm_quota_remaining_ratio",
    help: "Smallest share left in any quota window of an LLM key, 0..1",
    labelNames: ["provider", "account"] as const,
    registers,
    collect() {
      for (const { provider, account, budget } of budgets) this.set({ provider, account }, budget.remainingShare());
    },
  });

  // The last health check, refreshed when the dashboard asks: polling here would keep sleeping agents awake.
  let lastHealth: AgentHealthSnapshot | undefined;
  new Gauge({
    name: "agent_health",
    help: "Each agent's last known health: 1 on its current status (ok, degraded, asleep, unavailable)",
    labelNames: ["agent", "status"] as const,
    registers,
    collect() {
      this.reset();
      for (const entry of lastHealth?.agents ?? []) this.set({ agent: entry.agent, status: entry.asleep ? "asleep" : entry.status }, 1);
    },
  });
  new Gauge({
    name: "agent_health_checked_timestamp_seconds",
    help: "When the agents' health was last checked (Unix time)",
    registers,
    collect() {
      if (lastHealth) this.set(Date.parse(lastHealth.checkedAt) / 1000);
    },
  });

  return {
    ...metrics,
    recordHealth(snapshot: AgentHealthSnapshot): void {
      lastHealth = snapshot;
    },
    /** Every agent run of a finished review. */
    recordReport(report: CombinedReport): void {
      for (const run of report.agentRuns) {
        agentRuns.inc({ agent: run.agent, status: run.status });
        if (run.latencyMs !== undefined) agentLatency.observe({ agent: run.agent }, run.latencyMs / 1000);
      }
    },
    recordLookup(outcome: LookupOutcome): void {
      vectorLookups.inc({ outcome });
    },
  };
}

export type OrchestratorMetrics = ReturnType<typeof createOrchestratorMetrics>;
