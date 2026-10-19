import type { CombinedReport } from "@code-sentinel/contracts";
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

  return {
    ...metrics,
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
