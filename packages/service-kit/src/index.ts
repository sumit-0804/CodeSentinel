/**
 * @code-sentinel/service-kit: the HTTP plumbing every Code-Sentinel service shares — structured
 * logging, request ids, the request log, `ApiError` responses and env-file loading.
 */

export { loadEnvFile, envFileName, type Env } from "./env-file.js";
export { errorHandler, notFoundHandler } from "./http/error-handler.js";
export { badGateway, badRequest, HttpError, notFound, unauthorized, unprocessable } from "./http/errors.js";
export { REQUEST_ID_HEADER, requestIdMiddleware } from "./http/request-id.js";
export { requestLoggerMiddleware } from "./http/request-logger.js";
export type { ServiceHandler, ServiceLocals, ServiceResponse } from "./locals.js";
export {
  createJsonLogger,
  noopLogger,
  REDACTED,
  redactFields,
  type LogFields,
  type Logger,
  type LogLevel,
  type LogStream,
} from "./logging/logger.js";
