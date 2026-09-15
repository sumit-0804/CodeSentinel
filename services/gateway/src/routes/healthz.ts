import type { GatewayHealth } from "@code-sentinel/contracts";
import { Router } from "express";

import type { OrchestratorClientLike } from "../orchestrator/orchestrator-client.js";

export interface HealthzRouterDeps {
  orchestrator: Pick<OrchestratorClientLike, "health">;
  version: string;
}

/** `GET /healthz`: always 200; `degraded` when the orchestrator is not `ok` or unreachable. */
export function createHealthzRouter({ orchestrator, version }: HealthzRouterDeps): Router {
  const router = Router();

  router.get("/healthz", async (_req, res) => {
    let dependency: string;
    try {
      dependency = (await orchestrator.health()).status;
    } catch {
      dependency = "unavailable";
    }

    const body: GatewayHealth = {
      status: dependency === "ok" ? "ok" : "degraded",
      version,
      dependencies: { orchestrator: dependency },
    };
    res.json(body);
  });

  return router;
}
