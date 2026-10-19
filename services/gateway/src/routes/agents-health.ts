import type { AgentKind, AgentsHealth } from "@code-sentinel/contracts";
import type { Logger } from "@code-sentinel/service-kit";
import { Router, type Request } from "express";

import type { GatewayResponse } from "../auth/principal.js";
import type { OrchestratorClientLike } from "../orchestrator/orchestrator-client.js";

const AGENTS: AgentKind[] = ["security", "style", "performance", "logic", "documentation"];

export interface AgentsHealthRouterDeps {
  orchestrator: Pick<OrchestratorClientLike, "agentsHealth">;
  logger: Pick<Logger, "warn">;
  /** How long one answer is reused. */
  cacheMs?: number;
  now?: () => Date;
}

/** `GET /v1/agents/health` (WP6): the orchestrator's view of each agent, for the dashboard's notices. */
export function createAgentsHealthRouter({ orchestrator, logger, cacheMs = 15_000, now = () => new Date() }: AgentsHealthRouterDeps): Router {
  const router = Router();
  let cached: { at: number; body: Promise<AgentsHealth> } | undefined;

  const fetchHealth = async (): Promise<AgentsHealth> => {
    try {
      const snapshot = await orchestrator.agentsHealth();
      return {
        checkedAt: snapshot.checkedAt,
        agents: snapshot.agents.map(({ agent, status, latencyMs }) => ({ agent, status, ...(latencyMs !== undefined ? { latencyMs } : {}) })),
      };
    } catch (error) {
      logger.warn("agent health unavailable", { error });
      return { agents: AGENTS.map((agent) => ({ agent, status: "unknown" as const })) };
    }
  };

  router.get("/agents/health", async (_req: Request, res: GatewayResponse) => {
    const at = now().getTime();
    // Sharing the promise means a burst of dashboard pages makes one orchestrator call.
    if (!cached || at - cached.at >= cacheMs) cached = { at, body: fetchHealth() };
    res.json(await cached.body);
  });

  return router;
}
