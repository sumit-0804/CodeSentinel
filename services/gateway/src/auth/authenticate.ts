import { forbidden, unauthorized, type Logger } from "@code-sentinel/service-kit";
import type { NextFunction, Request } from "express";

import type { SessionStore, UserStore } from "../persistence/stores.js";
import type { GatewayResponse, Principal } from "./principal.js";
import type { SupabaseClaims, SupabaseTokenVerifier } from "./supabase-token.js";

export const ORGANIZATION_HEADER = "x-organization-id";

/** A signed-in user's profile is written at most this often, not on every request. */
const RECORD_SIGN_IN_EVERY_MS = 5 * 60_000;

export interface AuthMiddlewareDeps {
  sessions: SessionStore;
  users: UserStore;
  /** Absent when `SUPABASE_URL` is not configured: every Supabase token is then rejected. */
  supabase?: SupabaseTokenVerifier;
  logger?: Pick<Logger, "warn">;
  now?: () => Date;
}

const invalidCredentials = () => unauthorized("invalid_credentials", "The supplied credentials are not valid");

/**
 * Resolves `res.locals.principal` from `Authorization: Bearer` (FR-GW-02): a Supabase access token
 * whose session is still active. No header is 401 `unauthenticated`.
 */
export function createAuthMiddleware({ sessions, users, supabase, logger, now = () => new Date() }: AuthMiddlewareDeps) {
  const recordedAt = new Map<string, number>();

  async function supabasePrincipal(token: string, req: Request): Promise<Principal> {
    if (!supabase) throw invalidCredentials();
    let claims: SupabaseClaims;
    try {
      claims = await supabase.verify(token);
    } catch (error) {
      // The reason (expired, wrong audience, bad signature) is logged, never returned.
      logger?.warn("supabase token rejected", { reason: error instanceof Error ? error.message : String(error) });
      throw invalidCredentials();
    }

    if (!(await sessions.isActive(claims.sessionId))) {
      throw unauthorized("session_revoked", "This session has been signed out; sign in again");
    }

    const at = now();
    const last = recordedAt.get(claims.userId);
    if (last === undefined || at.getTime() - last >= RECORD_SIGN_IN_EVERY_MS) {
      await users.recordSignIn(
        {
          userId: claims.userId,
          ...(claims.email ? { email: claims.email } : {}),
          ...(claims.name ? { name: claims.name } : {}),
          ...(claims.avatarUrl ? { avatarUrl: claims.avatarUrl } : {}),
        },
        at,
      );
      recordedAt.set(claims.userId, at.getTime());
    }

    const organizationId = await resolveOrganization(claims.userId, req.get(ORGANIZATION_HEADER), users);
    return {
      userId: claims.userId,
      sessionId: claims.sessionId,
      aal: claims.aal,
      amr: claims.amr,
      providers: claims.providers,
      ...(organizationId ? { organizationId } : {}),
    };
  }

  return async (req: Request, res: GatewayResponse, next: NextFunction): Promise<void> => {
    const authorization = req.get("authorization");
    if (authorization === undefined) {
      throw unauthorized("unauthenticated", "Sign in and send your access token as a bearer token");
    }
    const token = /^Bearer\s+(\S+)$/i.exec(authorization.trim())?.[1];
    if (!token) throw invalidCredentials();

    const principal = await supabasePrincipal(token, req);
    res.locals.principal = principal;
    res.locals.logFields = { ...res.locals.logFields, userId: principal.userId, sessionId: principal.sessionId };
    next();
  };
}

/** The requested organization must be one of the user's; without a header, the only one they have. */
async function resolveOrganization(userId: string, requested: string | undefined, users: UserStore): Promise<string | undefined> {
  const memberships = (await users.findById(userId))?.memberships ?? [];
  if (requested !== undefined) {
    if (!memberships.some((m) => m.organizationId === requested)) {
      throw forbidden("organization_forbidden", "You are not a member of that organization");
    }
    return requested;
  }
  return memberships.length === 1 ? memberships[0]!.organizationId : undefined;
}
