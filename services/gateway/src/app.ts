import express, { type Express } from "express";
import helmet from "helmet";

import { createAuthMiddleware } from "./auth/authenticate.js";
import type { GatewayConfig } from "./config.js";
import { errorHandler, notFoundHandler } from "./http/error-handler.js";
import { requestIdMiddleware } from "./http/request-id.js";
import { requestLoggerMiddleware } from "./http/request-logger.js";
import type { Logger } from "./logging/logger.js";
import type { OrchestratorClientLike } from "./orchestrator/orchestrator-client.js";
import type { Stores } from "./persistence/stores.js";
import { createHealthzRouter } from "./routes/healthz.js";
import { createMeRouter } from "./routes/me.js";

export const DEFAULT_VERSION = "0.0.0";

/** Everything the app talks to, injected so tests pass fakes and in-memory stores. */
export interface AppDeps {
  config: GatewayConfig;
  logger: Logger;
  orchestrator: OrchestratorClientLike;
  stores: Stores;
  /** Reported by `/healthz`. */
  version?: string;
  /** Clock for session and API-key expiry checks. */
  now?: () => Date;
}

/**
 * The gateway's single Express entry point (FR-GW-01). Body parsers are mounted per route, never
 * globally, so the webhook route receives the exact bytes GitHub signed (FR-GW-03).
 */
export function createApp(deps: AppDeps): Express {
  const { config, logger, orchestrator, stores, version = DEFAULT_VERSION, now } = deps;
  const app = express();

  app.disable("x-powered-by");
  app.use(requestIdMiddleware());
  app.use(requestLoggerMiddleware(logger));
  app.use(helmet());

  app.use(createHealthzRouter({ orchestrator, version }));

  const v1 = express.Router();
  v1.use(express.json({ limit: "1mb" }));
  v1.use(
    createAuthMiddleware({
      jwtSecret: config.jwtSecret,
      sessions: stores.sessions,
      apiKeys: stores.apiKeys,
      ...(now ? { now } : {}),
    }),
  );
  v1.use(createMeRouter({ users: stores.users }));
  app.use("/v1", v1);

  app.use(notFoundHandler());
  app.use(errorHandler(logger));
  return app;
}
