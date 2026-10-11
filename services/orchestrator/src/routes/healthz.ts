import type { Health } from "@code-sentinel/contracts";
import { checkDependency } from "@code-sentinel/service-kit";
import { Router } from "express";

/** A cheap round trip to the database (`SELECT 1`); only present when reviews are stored in Postgres. */
export interface DatabaseHealth {
  ping(): Promise<unknown>;
}

export interface HealthzRouterDeps {
  version: string;
  database?: DatabaseHealth;
  /** How long the database ping may take before it counts as unavailable. */
  databaseTimeoutMs?: number;
}

/** `GET /healthz`: liveness and readiness; no auth, so probes can reach it. `degraded` when the database is not `ok`. */
export function createHealthzRouter({ version, database, databaseTimeoutMs }: HealthzRouterDeps): Router {
  const router = Router();
  router.get("/healthz", async (_req, res) => {
    if (!database) {
      const body: Health = { status: "ok", version };
      res.json(body);
      return;
    }
    const databaseStatus = await checkDependency(() => database.ping(), databaseTimeoutMs);
    const body: Health = { status: databaseStatus === "ok" ? "ok" : "degraded", version, checks: { database: databaseStatus } };
    res.json(body);
  });
  return router;
}
