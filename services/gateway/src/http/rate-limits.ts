import { HttpError } from "@code-sentinel/service-kit";
import type { Request, RequestHandler, Response } from "express";
import { rateLimit } from "express-rate-limit";

import type { GatewayLocals } from "../auth/principal.js";

export type Limiter = "webhook" | "user" | "write" | "failed_auth";

export interface RateLimitSettings {
  webhookPerMinute: number;
  userPerMinute: number;
  writePerMinute: number;
  failedAuthPer15Minutes: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitSettings = {
  webhookPerMinute: 300,
  userPerMinute: 120,
  writePerMinute: 20,
  failedAuthPer15Minutes: 20,
};

const MINUTE = 60_000;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The installation a webhook delivery came from; the signature was already checked, so this can't be forged. */
function installationKey(req: Request): string {
  try {
    const payload = JSON.parse((req.body as Buffer).toString("utf8")) as { installation?: { id?: unknown } };
    return typeof payload.installation?.id === "number" ? `installation:${payload.installation.id}` : "installation:none";
  } catch {
    return "installation:none";
  }
}

const userKey = (_req: Request, res: Response) => `user:${(res.locals as GatewayLocals).principal?.userId ?? "anonymous"}`;

/**
 * FR-GW-05. Counters live in this process's memory, which is right for one gateway instance; more
 * instances would need a shared store. Every limit answers 429 `rate_limited` with `Retry-After`.
 */
export function createRateLimits(settings: RateLimitSettings, onLimited: (limiter: Limiter) => void = () => {}) {
  const limiter = (name: Limiter, windowMs: number, limit: number, extra: Parameters<typeof rateLimit>[0] = {}): RequestHandler =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler: (_req, _res, next) => {
        onLimited(name);
        next(new HttpError(429, "rate_limited", "Too many requests; try again after the time in Retry-After"));
      },
      ...extra,
    });

  return {
    /** Per installation, after the signature check (so a forged delivery never counts). */
    webhook: limiter("webhook", MINUTE, settings.webhookPerMinute, { keyGenerator: installationKey }),
    /** Per IP, before authentication; only requests that end in 401 count. */
    failedAuth: limiter("failed_auth", 15 * MINUTE, settings.failedAuthPer15Minutes, {
      skipSuccessfulRequests: true,
      requestWasSuccessful: (_req, res) => res.statusCode !== 401,
    }),
    /** Per signed-in user, after authentication. */
    user: limiter("user", MINUTE, settings.userPerMinute, { keyGenerator: userKey }),
    /** Per signed-in user, on writes only: configuration, fix commits, re-runs, syncs. */
    write: limiter("write", MINUTE, settings.writePerMinute, { keyGenerator: userKey, skip: (req) => !WRITE_METHODS.has(req.method) }),
  };
}
