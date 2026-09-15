import type { NextFunction, Request } from "express";

import { readCookie } from "../http/cookies.js";
import { unauthorized } from "../http/errors.js";
import type { ApiKeyStore, SessionStore } from "../persistence/stores.js";
import { sha256Hex } from "./hash.js";
import type { GatewayResponse, Principal } from "./principal.js";
import { SESSION_COOKIE, verifySessionToken, type SessionClaims } from "./session-token.js";

/** Personal API keys always carry this prefix, so a bearer token is never mistaken for a JWT. */
export const API_KEY_PREFIX = "cs_live_";

export interface AuthMiddlewareDeps {
  jwtSecret: string;
  sessions: SessionStore;
  apiKeys: ApiKeyStore;
  now?: () => Date;
}

const invalidCredentials = () => unauthorized("invalid_credentials", "The supplied credentials are not valid");

/**
 * Resolves the caller on `/v1` routes (FR-GW-02) and sets `res.locals.principal`.
 *
 * - `Authorization: Bearer cs_live_…` (VS Code): the key's SHA-256 must match an active API key.
 * - `cs_session` cookie (dashboard): an HS256 JWT whose signature and expiry are checked, then its
 *   SHA-256 must match an active session with the same ids, so revoking a session takes effect
 *   before the JWT expires.
 *
 * No credential is 401 `unauthenticated`; anything present but wrong is 401 `invalid_credentials`.
 * An `Authorization` header is decisive: a bad one is rejected even if a valid cookie is also sent.
 */
export function createAuthMiddleware({ jwtSecret, sessions, apiKeys, now = () => new Date() }: AuthMiddlewareDeps) {
  return async (req: Request, res: GatewayResponse, next: NextFunction): Promise<void> => {
    const authorization = req.get("authorization");
    if (authorization !== undefined) {
      res.locals.principal = await apiKeyPrincipal(authorization, apiKeys, now());
      next();
      return;
    }

    const token = readCookie(req.get("cookie"), SESSION_COOKIE);
    if (token === undefined) {
      throw unauthorized("unauthenticated", "Sign in or send an API key as a bearer token");
    }
    res.locals.principal = await sessionPrincipal(token, jwtSecret, sessions, now());
    next();
  };
}

async function apiKeyPrincipal(authorization: string, apiKeys: ApiKeyStore, now: Date): Promise<Principal> {
  const key = /^Bearer\s+(\S+)$/i.exec(authorization.trim())?.[1];
  if (!key?.startsWith(API_KEY_PREFIX)) throw invalidCredentials();

  const record = await apiKeys.findActiveByKeyHash(sha256Hex(key));
  if (!record) throw invalidCredentials();

  await apiKeys.touchLastUsed(record.keyId, now);
  return { userId: record.userId, organizationId: record.organizationId, method: "api_key" };
}

async function sessionPrincipal(token: string, jwtSecret: string, sessions: SessionStore, now: Date): Promise<Principal> {
  let claims: SessionClaims;
  try {
    claims = await verifySessionToken(token, jwtSecret, { now });
  } catch {
    throw invalidCredentials();
  }

  const session = await sessions.findActiveByTokenHash(sha256Hex(token), now);
  if (
    !session ||
    session.sessionId !== claims.sessionId ||
    session.userId !== claims.userId ||
    session.organizationId !== claims.organizationId
  ) {
    throw invalidCredentials();
  }
  return { userId: session.userId, organizationId: session.organizationId, method: "session" };
}
