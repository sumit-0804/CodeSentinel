import type { GatewayHealth } from "@code-sentinel/contracts";
import { checkDependency } from "@code-sentinel/service-kit";
import { Router } from "express";

import type { OrchestratorClientLike } from "../orchestrator/orchestrator-client.js";

/** A cheap round trip to the database (`SELECT 1`); only present when the gateway uses Postgres. */
export interface DatabaseHealth {
  ping(): Promise<unknown>;
}

export interface HealthzRouterDeps {
  orchestrator: Pick<OrchestratorClientLike, "health">;
  database?: DatabaseHealth;
  version: string;
  /** How long the database ping may take before it counts as unavailable. */
  databaseTimeoutMs?: number;
}

/** `GET /healthz`: always 200; `degraded` when the orchestrator or the database is not `ok`. */
export function createHealthzRouter({ orchestrator, database, version, databaseTimeoutMs = 2000 }: HealthzRouterDeps): Router {
  const router = Router();

  router.get("/healthz", async (_req, res) => {
    const [orchestratorStatus, databaseStatus] = await Promise.all([
      orchestrator.health().then(
        (health) => health.status,
        () => "unavailable",
      ),
      database ? checkDependency(() => database.ping(), databaseTimeoutMs) : undefined,
    ]);

    const dependencies: Record<string, string> = {
      orchestrator: orchestratorStatus,
      ...(databaseStatus ? { database: databaseStatus } : {}),
    };
    const body: GatewayHealth = {
      status: Object.values(dependencies).every((status) => status === "ok") ? "ok" : "degraded",
      version,
      dependencies,
    };
    res.json(body);
  });

  return router;
}
