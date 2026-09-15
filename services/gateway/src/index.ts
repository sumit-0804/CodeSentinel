/**
 * @code-sentinel/gateway
 *
 * The API gateway: GitHub webhook receipt, session and API-key auth, and routing to the
 * orchestrator (FR-GW-01…04). `server.ts` is the process entry point; this module exports the
 * pieces so they can be composed and tested without starting a server.
 */

export { createApp, type AppDeps } from "./app.js";
export { GatewayConfigError, loadGatewayConfig, type GatewayConfig } from "./config.js";
export { createJsonLogger, noopLogger, type Logger } from "./logging/logger.js";
export { HttpError } from "./http/errors.js";
