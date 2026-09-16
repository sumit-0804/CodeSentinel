import type { NextFunction, Request, Response } from "express";

/** What the kit's middleware stores on `res.locals`; services extend it with their own fields. */
export interface ServiceLocals {
  /** Set by `requestIdMiddleware` before any other handler runs (NFR-12). */
  requestId: string;
  /** Extra fields for the request log line, e.g. a webhook delivery id or a job id. */
  logFields?: Record<string, unknown>;
}

export type ServiceResponse<Locals extends ServiceLocals = ServiceLocals> = Response<unknown, Locals>;
export type ServiceHandler<Locals extends ServiceLocals = ServiceLocals> = (
  req: Request,
  res: ServiceResponse<Locals>,
  next: NextFunction,
) => unknown;
