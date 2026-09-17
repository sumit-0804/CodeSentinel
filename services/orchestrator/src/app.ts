import {
  errorHandler,
  notFoundHandler,
  requestIdMiddleware,
  requestLoggerMiddleware,
  type Logger,
} from "@code-sentinel/service-kit";
import express, { type Express } from "express";
import helmet from "helmet";

import { serviceAuthMiddleware } from "./http/service-auth.js";
import { createAgentsHealthRouter, type AgentsHealthRouterDeps } from "./routes/agents-health.js";
import { createHealthzRouter } from "./routes/healthz.js";
import { createReviewJobsRouter, type ReviewJobsRouterDeps } from "./routes/review-jobs.js";

export const DEFAULT_VERSION = "0.0.0";

/** Everything the app talks to, injected so tests pass fakes. */
export interface AppDeps {
  serviceToken: string;
  logger: Logger;
  controller: ReviewJobsRouterDeps["controller"];
  agentsHealth: AgentsHealthRouterDeps;
  /** Reported by `/healthz`. */
  version?: string;
}

/** The orchestrator's HTTP layer (`orchestrator.yaml`). Only the gateway calls `/internal/*`. */
export function createApp(deps: AppDeps): Express {
  const { serviceToken, logger, controller, agentsHealth, version = DEFAULT_VERSION } = deps;
  const app = express();

  app.disable("x-powered-by");
  app.use(requestIdMiddleware());
  app.use(requestLoggerMiddleware(logger));
  app.use(helmet());

  app.use(createHealthzRouter({ version }));

  const internal = express.Router();
  internal.use(serviceAuthMiddleware(serviceToken));
  internal.use(createReviewJobsRouter({ controller }));
  internal.use(createAgentsHealthRouter(agentsHealth));
  app.use("/internal/v1", internal);

  app.use(notFoundHandler());
  app.use(errorHandler(logger));
  return app;
}
