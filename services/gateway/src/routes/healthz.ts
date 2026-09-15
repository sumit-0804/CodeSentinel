import type { GatewayHealth } from "@code-sentinel/contracts";
import { Router } from "express";

export interface HealthzRouterDeps {
  version: string;
}

/** `GET /healthz`: liveness and readiness probe, no authentication. */
export function createHealthzRouter({ version }: HealthzRouterDeps): Router {
  const router = Router();
  router.get("/healthz", (_req, res) => {
    const body: GatewayHealth = { status: "ok", version, dependencies: {} };
    res.json(body);
  });
  return router;
}
