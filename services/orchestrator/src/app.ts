import {
  errorHandler,
  notFoundHandler,
  requestIdMiddleware,
  requestLoggerMiddleware,
  serviceAuthMiddleware,
  type Logger,
  type Metrics,
} from "@code-sentinel/service-kit";
import express, { type Express } from "express";
import helmet from "helmet";

import { createAgentsHealthRouter, type AgentsHealthRouterDeps } from "./routes/agents-health.js";
import { createHealthzRouter, type DatabaseHealth } from "./routes/healthz.js";
import { createReviewJobsRouter, type ReviewJobsRouterDeps } from "./routes/review-jobs.js";

export const DEFAULT_VERSION = "0.0.0";

/** Everything the app talks to, injected so tests pass fakes. */
export interface AppDeps {
  serviceToken: string;
  logger: Logger;
  controller: ReviewJobsRouterDeps["controller"];
  agentsHealth: AgentsHealthRouterDeps;
  /** Pinged by `/healthz` when reviews are stored in Postgres. */
  database?: DatabaseHealth;
  /** Reported by `/healthz`. */
  version?: string;
  /** Request timing and `GET /metrics` (behind `metricsToken`); omitted in tests that don't check them. */
  metrics?: Pick<Metrics, "httpMiddleware" | "router">;
  metricsToken?: string;
}

/** The orchestrator's HTTP layer (`orchestrator.yaml`). Only the gateway calls `/internal/*`. */
export function createApp(deps: AppDeps): Express {
  const { serviceToken, logger, controller, agentsHealth, database, version = DEFAULT_VERSION, metrics, metricsToken } = deps;
  const app = express();

  app.disable("x-powered-by");
  if (metrics) app.use(metrics.httpMiddleware);
  app.use(requestIdMiddleware());
  app.use(requestLoggerMiddleware(logger));
  app.use(helmet());
  if (metrics) app.use(metrics.router(metricsToken));

  app.use(createHealthzRouter({ version, ...(database ? { database } : {}) }));

  const internal = express.Router();
  internal.use(serviceAuthMiddleware(serviceToken));
  internal.use(createReviewJobsRouter({ controller }));
  internal.use(createAgentsHealthRouter(agentsHealth));
  app.use("/internal/v1", internal);

  app.use(notFoundHandler());
  app.use(errorHandler(logger));
  return app;
}
