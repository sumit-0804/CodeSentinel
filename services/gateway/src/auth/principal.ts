import type { NextFunction, Request, Response } from "express";

/** Who is calling, resolved by the auth middleware (FR-GW-02). Every read is scoped to `organizationId` (NFR-13). */
export interface Principal {
  userId: string;
  organizationId: string;
  method: "session" | "api_key";
}

/** What the gateway's middleware stores on `res.locals`. */
export interface GatewayLocals {
  /** Set by `requestIdMiddleware` before any other handler runs (NFR-12). */
  requestId: string;
  /** Set by the auth middleware on `/v1` routes. */
  principal?: Principal;
  /** Extra fields for the request log line, e.g. the webhook delivery id and outcome. */
  logFields?: Record<string, unknown>;
}

export type GatewayResponse = Response<unknown, GatewayLocals>;
export type GatewayHandler = (req: Request, res: GatewayResponse, next: NextFunction) => unknown;
