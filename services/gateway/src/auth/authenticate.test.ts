import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "../http/error-handler.js";
import { requestIdMiddleware } from "../http/request-id.js";
import { noopLogger } from "../logging/logger.js";
import {
  seededStores,
  TEST_API_KEY_ID,
  TEST_JWT_SECRET,
  TEST_SESSION_ID,
  TEST_USER_ID,
  type SeededStores,
} from "../test-support/fixtures.js";
import { withServer } from "../test-support/with-server.js";
import { createAuthMiddleware } from "./authenticate.js";
import type { GatewayResponse } from "./principal.js";
import type * as SessionTokenModule from "./session-token.js";
import { signSessionToken, verifySessionToken } from "./session-token.js";

vi.mock("./session-token.js", async (importOriginal) => {
  const original = await importOriginal<typeof SessionTokenModule>();
  return { ...original, verifySessionToken: vi.fn(original.verifySessionToken) };
});

const NOW = new Date("2026-09-15T12:00:00Z");

/** An app whose only route echoes the resolved principal. */
function authApp({ stores }: SeededStores) {
  const app = express();
  app.use(requestIdMiddleware());
  app.use(createAuthMiddleware({ jwtSecret: TEST_JWT_SECRET, sessions: stores.sessions, apiKeys: stores.apiKeys, now: () => NOW }));
  app.get("/whoami", (_req, res: GatewayResponse) => {
    res.json(res.locals.principal);
  });
  app.use(errorHandler(noopLogger));
  return app;
}

async function whoami(seeded: SeededStores, headers: Record<string, string> = {}) {
  let result!: { status: number; body: Record<string, unknown> };
  await withServer(authApp(seeded), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/whoami`, { headers });
    result = { status: response.status, body: (await response.json()) as Record<string, unknown> };
  });
  return result;
}

describe("createAuthMiddleware", () => {
  beforeEach(() => {
    vi.mocked(verifySessionToken).mockClear();
  });

  it("answers 401 unauthenticated without credentials", async () => {
    const { status, body } = await whoami(await seededStores());

    expect(status).toBe(401);
    expect(body.code).toBe("unauthenticated");
  });

  it("accepts a valid API key and records its last use", async () => {
    const seeded = await seededStores();

    const { status, body } = await whoami(seeded, { Authorization: `Bearer ${seeded.apiKey}` });

    expect(status).toBe(200);
    expect(body).toEqual({ userId: TEST_USER_ID, organizationId: seeded.seed.organizations[0]!.organizationId, method: "api_key" });
    const key = await seeded.stores.apiKeys.findActiveByKeyHash(seeded.seed.apiKeys[0]!.keyHash);
    expect(key?.lastUsedAt).toEqual(NOW);
  });

  it("rejects an unknown API key", async () => {
    const { status, body } = await whoami(await seededStores(), { Authorization: "Bearer cs_live_unknown" });

    expect(status).toBe(401);
    expect(body.code).toBe("invalid_credentials");
  });

  it("rejects a revoked API key", async () => {
    const seeded = await seededStores((seed) => {
      seed.apiKeys.find((key) => key.keyId === TEST_API_KEY_ID)!.revokedAt = new Date("2026-09-01T00:00:00Z");
    });

    const { status, body } = await whoami(seeded, { Authorization: `Bearer ${seeded.apiKey}` });

    expect(status).toBe(401);
    expect(body.code).toBe("invalid_credentials");
  });

  it("accepts a session cookie whose session is active", async () => {
    const seeded = await seededStores();

    const { status, body } = await whoami(seeded, { Cookie: `theme=dark; cs_session=${seeded.sessionToken}` });

    expect(status).toBe(200);
    expect(body).toMatchObject({ userId: TEST_USER_ID, method: "session" });
  });

  it("rejects a valid JWT whose session was revoked", async () => {
    const seeded = await seededStores((seed) => {
      seed.sessions.find((session) => session.sessionId === TEST_SESSION_ID)!.revokedAt = new Date("2026-09-15T11:00:00Z");
    });

    const { status, body } = await whoami(seeded, { Cookie: `cs_session=${seeded.sessionToken}` });

    expect(status).toBe(401);
    expect(body.code).toBe("invalid_credentials");
  });

  it("rejects a JWT with a bad signature", async () => {
    const seeded = await seededStores();
    const forged = await signSessionToken(
      { userId: TEST_USER_ID, organizationId: seeded.seed.organizations[0]!.organizationId, sessionId: TEST_SESSION_ID },
      "attacker-secret-0123456789abcdef-012",
    );

    const { status, body } = await whoami(seeded, { Cookie: `cs_session=${forged}` });

    expect(status).toBe(401);
    expect(body.code).toBe("invalid_credentials");
  });

  it("rejects a bearer token without the cs_live_ prefix and never treats it as a JWT", async () => {
    const seeded = await seededStores();

    const { status, body } = await whoami(seeded, { Authorization: `Bearer ${seeded.sessionToken}` });

    expect(status).toBe(401);
    expect(body.code).toBe("invalid_credentials");
    expect(verifySessionToken).not.toHaveBeenCalled();
  });
});
