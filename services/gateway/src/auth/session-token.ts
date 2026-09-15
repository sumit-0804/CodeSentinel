import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "cs_session";
export const SESSION_TOKEN_ISSUER = "code-sentinel";
const ALGORITHM = "HS256";

/** What a `cs_session` JWT identifies: `sub`, `org` and `jti`. */
export interface SessionClaims {
  userId: string;
  organizationId: string;
  sessionId: string;
}

export interface SignSessionTokenOptions {
  /** Defaults to one day. */
  ttlSeconds?: number;
  now?: Date;
}

const keyFor = (secret: string) => new TextEncoder().encode(secret);

/**
 * Mints the HS256 JWT carried by the `cs_session` cookie. The GitHub OAuth login will call this;
 * until then tests and the manual check do. Its SHA-256 must also be stored as a session row.
 */
export async function signSessionToken(
  claims: SessionClaims,
  secret: string,
  { ttlSeconds = 86400, now = new Date() }: SignSessionTokenOptions = {},
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({ org: claims.organizationId })
    .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
    .setSubject(claims.userId)
    .setJti(claims.sessionId)
    .setIssuer(SESSION_TOKEN_ISSUER)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ttlSeconds)
    .sign(keyFor(secret));
}

/**
 * Verifies signature, algorithm (HS256 only), issuer and expiry, and returns the ids.
 * Throws on any failure; the caller maps that to 401 `invalid_credentials`.
 */
export async function verifySessionToken(
  token: string,
  secret: string,
  { now }: { now?: Date } = {},
): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, keyFor(secret), {
    algorithms: [ALGORITHM],
    issuer: SESSION_TOKEN_ISSUER,
    ...(now ? { currentDate: now } : {}),
  });

  const { sub, jti, org } = payload;
  if (typeof sub !== "string" || typeof jti !== "string" || typeof org !== "string") {
    throw new Error("session token is missing sub, jti or org");
  }
  return { userId: sub, organizationId: org, sessionId: jti };
}
