import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { SESSION_TOKEN_ISSUER, signSessionToken, verifySessionToken } from "./session-token.js";

const SECRET = "session-secret-0123456789abcdef-01";
const CLAIMS = {
  userId: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
  organizationId: "7d9e1f2a-3b4c-4d5e-8f60-718293a4b5c6",
  sessionId: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
};

describe("session tokens", () => {
  it("verifies a signed token and returns the three ids", async () => {
    const token = await signSessionToken(CLAIMS, SECRET);

    await expect(verifySessionToken(token, SECRET)).resolves.toEqual(CLAIMS);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSessionToken(CLAIMS, "another-secret-0123456789abcdef-01");

    await expect(verifySessionToken(token, SECRET)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const issued = new Date("2026-09-01T00:00:00Z");
    const token = await signSessionToken(CLAIMS, SECRET, { ttlSeconds: 60, now: issued });

    await expect(verifySessionToken(token, SECRET, { now: new Date("2026-09-01T00:00:30Z") })).resolves.toEqual(CLAIMS);
    await expect(verifySessionToken(token, SECRET, { now: new Date("2026-09-01T00:02:00Z") })).rejects.toThrow();
  });

  it("rejects a token signed with HS512", async () => {
    const token = await new SignJWT({ org: CLAIMS.organizationId })
      .setProtectedHeader({ alg: "HS512" })
      .setSubject(CLAIMS.userId)
      .setJti(CLAIMS.sessionId)
      .setIssuer(SESSION_TOKEN_ISSUER)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(SECRET));

    await expect(verifySessionToken(token, SECRET)).rejects.toThrow();
  });
});
