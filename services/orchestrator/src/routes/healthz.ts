import type { Health } from "@code-sentinel/contracts";
import { Router } from "express";

/** `GET /healthz`: liveness and readiness; no auth, so probes can reach it. */
export function createHealthzRouter({ version }: { version: string }): Router {
  const router = Router();
  router.get("/healthz", (_req, res) => {
    const body: Health = { status: "ok", version };
    res.json(body);
  });
  return router;
}
