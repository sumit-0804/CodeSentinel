import type { AuditAction, AuditTargetType } from "@code-sentinel/contracts";
import { HttpError, type Logger } from "@code-sentinel/service-kit";
import type { NextFunction, Request } from "express";

import type { GatewayResponse } from "../auth/principal.js";
import type { AuditEventInput, AuditStore } from "../persistence/stores.js";

export interface AuditDetails {
  action: AuditAction;
  targetType?: AuditTargetType;
  targetId?: string;
  metadata?: Record<string, unknown>;
  /** Defaults to the caller's organization. */
  organizationId?: string;
}

/**
 * Writes the admins' audit log (WP6). An entry never fails or delays the action it records: a failed
 * write is logged and dropped.
 */
export function createAuditLog(store: Pick<AuditStore, "record">, logger: Logger, now: () => Date = () => new Date()) {
  const write = async (event: AuditEventInput) => {
    try {
      await store.record(event);
    } catch (error) {
      logger.warn("audit event not recorded", { action: event.action, requestId: event.requestId, error });
    }
  };

  return {
    /** An action by the signed-in caller of this request, with its IP, browser and request id. */
    request: (req: Request, res: GatewayResponse, details: AuditDetails): Promise<void> => {
      const principal = res.locals.principal;
      const organizationId = details.organizationId ?? principal?.organizationId;
      const userAgent = req.get("user-agent");
      return write({
        action: details.action,
        ...(organizationId ? { organizationId } : {}),
        ...(principal ? { userId: principal.userId } : {}),
        ...(details.targetType ? { targetType: details.targetType } : {}),
        ...(details.targetId ? { targetId: details.targetId } : {}),
        ...(req.ip ? { ip: req.ip } : {}),
        ...(userAgent ? { userAgent } : {}),
        requestId: res.locals.requestId,
        ...(details.metadata ? { metadata: details.metadata } : {}),
        at: now(),
      });
    },
    /** An action that came from GitHub (a webhook), not a dashboard request. */
    event: (details: AuditDetails & { organizationId: string; userId?: string; requestId?: string }): Promise<void> =>
      write({ ...details, at: now() }),
  };
}

export type AuditLog = ReturnType<typeof createAuditLog>;

/** Puts the caller's IP and browser on the request log line of every `/v1` request (WP6). */
export const requestOrigin = (req: Request, res: GatewayResponse, next: NextFunction): void => {
  const userAgent = req.get("user-agent");
  res.locals.logFields = { ...res.locals.logFields, ip: req.ip, ...(userAgent ? { userAgent } : {}) };
  next();
};

/** Records a write refused for want of a fresh TOTP code, then passes the error on unchanged. */
export function auditRefusedStepUp(audit: Pick<AuditLog, "request">) {
  return async (error: unknown, req: Request, res: GatewayResponse, next: NextFunction): Promise<void> => {
    if (error instanceof HttpError && error.code === "mfa_required" && res.locals.principal) {
      await audit.request(req, res, { action: "step_up_refused", metadata: { method: req.method, path: req.originalUrl.split("?")[0] } });
    }
    next(error);
  };
}
