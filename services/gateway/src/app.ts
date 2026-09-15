import express, { type Express } from "express";
import helmet from "helmet";

import type { GatewayConfig } from "./config.js";
import { errorHandler, notFoundHandler } from "./http/error-handler.js";
import { requestIdMiddleware } from "./http/request-id.js";
import { requestLoggerMiddleware } from "./http/request-logger.js";
import type { Logger } from "./logging/logger.js";
import { createHealthzRouter } from "./routes/healthz.js";

export const DEFAULT_VERSION = "0.0.0";

/** Everything the app talks to, injected so tests pass fakes and in-memory stores. */
export interface AppDeps {
  config: GatewayConfig;
  logger: Logger;
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
  const { logger, version = DEFAULT_VERSION } = deps;
  const app = express();

  app.disable("x-powered-by");
  app.use(requestIdMiddleware());
  app.use(requestLoggerMiddleware(logger));
  app.use(helmet());

  app.use(createHealthzRouter({ version }));

  app.use(notFoundHandler());
  app.use(errorHandler(logger));
  return app;
}
