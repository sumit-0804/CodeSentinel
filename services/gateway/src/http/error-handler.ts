import type { ApiError } from "@code-sentinel/contracts";
import type { NextFunction, Request } from "express";
import { ZodError } from "zod";

import type { GatewayHandler, GatewayResponse } from "../auth/principal.js";
import type { Logger } from "../logging/logger.js";
import { HttpError } from "./errors.js";

/** Errors raised by `express.json` / `express.raw` (body-parser) carry these fields. */
interface BodyParserError {
  status: number;
  type: string;
  expose: boolean;
  message: string;
}

const BODY_PARSER_CODES: Record<number, string> = {
  413: "payload_too_large",
  415: "unsupported_media_type",
};

function isBodyParserError(error: unknown): error is BodyParserError {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as Partial<BodyParserError>;
  return (
    typeof candidate.status === "number" &&
    candidate.status >= 400 &&
    candidate.status < 500 &&
    typeof candidate.type === "string" &&
    candidate.expose === true
  );
}

/** Answers every unmatched route with 404 `not_found`. Mount after all routers. */
export function notFoundHandler(): GatewayHandler {
  return (req, _res, next) => {
    next(new HttpError(404, "not_found", `No route for ${req.method} ${req.path}`));
  };
}

/**
 * Turns anything thrown by a handler into an `ApiError` body that echoes the request id (NFR-12).
 * Unknown errors become a 500 with a fixed message; their detail goes to the log only.
 */
export function errorHandler(logger: Logger) {
  return (error: unknown, _req: Request, res: GatewayResponse, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const { requestId } = res.locals;
    let status: number;
    let body: ApiError;

    if (error instanceof HttpError) {
      status = error.status;
      body = { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
    } else if (error instanceof ZodError) {
      status = 400;
      body = { code: "invalid_body", message: "Request body failed validation", details: { issues: error.issues } };
    } else if (isBodyParserError(error)) {
      status = error.status;
      body = { code: BODY_PARSER_CODES[error.status] ?? "invalid_body", message: error.message };
    } else {
      status = 500;
      body = { code: "internal_error", message: "Internal server error" };
      logger.error("unhandled error", { requestId, error });
    }

    res.status(status).json({ ...body, requestId });
  };
}
