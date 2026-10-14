import { EXAMPLE_ORGANIZATION_ID } from "@code-sentinel/contracts/examples";
import { errorHandler, noopLogger, requestIdMiddleware } from "@code-sentinel/service-kit";
import { withServer } from "@code-sentinel/service-kit/testing";
import express from "express";
import { describe, expect, it, vi } from "vitest";

import { seededStores, TEST_USER_ID, type SeededStores } from "../test-support/fixtures.js";
import { TEST_SUPABASE_SESSION_ID, testSupabase, type TestSupabase } from "../test-support/supabase-tokens.js";
import { createAuthMiddleware } from "./authenticate.js";
import { requireOrganization } from "./guards.js";
import type { GatewayResponse } from "./principal.js";

const NOW = new Date("2026-10-11T12:00:00Z");
const NEW_USER_ID = "3a4b5c6d-7e8f-4a0b-9c1d-2e3f4a5b6c7d";
const OTHER_ORG_ID = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";

/** Echoes the principal at `/whoami`; `/org` sits behind `requireOrganization`. */
function authApp({ stores }: SeededStores, supabase?: TestSupabase, now: () => Date = () => NOW) {
  const app = express();
  app.use(requestIdMiddleware());
  app.use(
    createAuthMiddleware({
      sessions: stores.sessions,
      users: stores.users,
      ...(supabase ? { supabase: supabase.verifier } : {}),
      now,
    }),
  );
  const echo = (_req: express.Request, res: GatewayResponse) => {
    res.json(res.locals.principal);
  };
  app.get("/whoami", echo);
  app.get("/org", requireOrganization, echo);
  app.use(errorHandler(noopLogger));
  return app;
}

async function call(app: express.Express, path: string, headers: Record<string, string> = {}) {
  let result!: { status: number; body: Record<string, unknown> };
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}${path}`, { headers });
    result = { status: response.status, body: (await response.json()) as Record<string, unknown> };
  });
  return result;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("createAuthMiddleware: missing or malformed credentials", () => {
  it("answers 401 unauthenticated without credentials", async () => {
    const { status, body } = await call(authApp(await seededStores()), "/whoami");

    expect(status).toBe(401);
    expect(body.code).toBe("unauthenticated");
  });

  it.each(["Bearer not-a-jwt", "Basic abc", "Bearer"])("rejects %j as invalid_credentials", async (authorization) => {
    const supabase = await testSupabase(() => NOW);

    const { status, body } = await call(authApp(await seededStores(), supabase), "/whoami", { Authorization: authorization });

    expect(status).toBe(401);
    expect(body.code).toBe("invalid_credentials");
  });

  it("ignores cookies: the old cs_session cookie is not a credential any more", async () => {
    const { status, body } = await call(authApp(await seededStores()), "/whoami", { Cookie: "cs_session=anything" });

    expect(status).toBe(401);
    expect(body.code).toBe("unauthenticated");
  });
});

describe("createAuthMiddleware: Supabase access tokens", () => {
  it("accepts a valid token and resolves the user's only organization", async () => {
    const supabase = await testSupabase(() => NOW);

    const { status, body } = await call(authApp(await seededStores(), supabase), "/whoami", bearer(await supabase.sign(TEST_USER_ID)));

    expect(status).toBe(200);
    expect(body).toMatchObject({
      userId: TEST_USER_ID,
      sessionId: TEST_SUPABASE_SESSION_ID,
      aal: "aal1",
      organizationId: EXAMPLE_ORGANIZATION_ID,
    });
  });

  it.each([
    ["the wrong audience", { audience: "anon" }],
    ["the wrong issuer", { issuer: "https://other.supabase.co/auth/v1" }],
    ["an expired token", { expiresInSeconds: -600 }],
  ])("rejects %s", async (_label, options) => {
    const supabase = await testSupabase(() => NOW);
    const token = await supabase.sign(TEST_USER_ID, {}, options);

    const { status, body } = await call(authApp(await seededStores(), supabase), "/whoami", bearer(token));

    expect(status).toBe(401);
    expect(body.code).toBe("invalid_credentials");
  });

  it.each([
    ["an anon role", { role: "anon" }],
    ["a service_role token", { role: "service_role" }],
    ["a missing session id", { session_id: undefined }],
  ])("rejects %s", async (_label, claims) => {
    const supabase = await testSupabase(() => NOW);

    const { status, body } = await call(authApp(await seededStores(), supabase), "/whoami", bearer(await supabase.sign(TEST_USER_ID, claims)));

    expect(status).toBe(401);
    expect(body.code).toBe("invalid_credentials");
  });

  it("rejects a token signed by a key outside the project's JWKS", async () => {
    const supabase = await testSupabase(() => NOW);

    const { status } = await call(authApp(await seededStores(), supabase), "/whoami", bearer(await supabase.signWithForeignKey(TEST_USER_ID)));

    expect(status).toBe(401);
  });

  it("rejects HS256 and unsigned tokens", async () => {
    const supabase = await testSupabase(() => NOW);
    const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString("base64url");
    const payload = encode({ sub: TEST_USER_ID, role: "authenticated", aud: "authenticated", session_id: TEST_SUPABASE_SESSION_ID });
    const unsigned = `${encode({ alg: "none" })}.${payload}.`;
    const hs256 = `${encode({ alg: "HS256", typ: "JWT" })}.${payload}.c2lnbmF0dXJl`;

    for (const token of [unsigned, hs256]) {
      const { status } = await call(authApp(await seededStores(), supabase), "/whoami", bearer(token));
      expect(status).toBe(401);
    }
  });

  it("rejects every token when Supabase is not configured", async () => {
    const supabase = await testSupabase(() => NOW);

    const { status, body } = await call(authApp(await seededStores()), "/whoami", bearer(await supabase.sign(TEST_USER_ID)));

    expect(status).toBe(401);
    expect(body.code).toBe("invalid_credentials");
  });

  it("answers 401 session_revoked once the session is signed out", async () => {
    const supabase = await testSupabase(() => NOW);
    const seeded = await seededStores((seed) => {
      seed.activeSessionIds = [];
    });

    const { status, body } = await call(authApp(seeded, supabase), "/whoami", bearer(await supabase.sign(TEST_USER_ID)));

    expect(status).toBe(401);
    expect(body.code).toBe("session_revoked");
  });

  it("records a first-time user from the token's claims", async () => {
    const supabase = await testSupabase(() => NOW);
    const seeded = await seededStores();

    const { status, body } = await call(authApp(seeded, supabase), "/whoami", bearer(await supabase.sign(NEW_USER_ID)));

    expect(status).toBe(200);
    expect(body).not.toHaveProperty("organizationId");
    expect(await seeded.stores.users.findById(NEW_USER_ID)).toEqual({
      userId: NEW_USER_ID,
      email: "ada@example.com",
      name: "Ada Lovelace",
      avatarUrl: "https://avatars.example/ada.png",
      memberships: [],
    });
  });

  it("records a sign-in at most once every five minutes per user", async () => {
    const supabase = await testSupabase(() => NOW);
    const seeded = await seededStores();
    const recordSignIn = vi.spyOn(seeded.stores.users, "recordSignIn");
    let clock = NOW.getTime();
    const app = authApp(seeded, supabase, () => new Date(clock));
    const token = await supabase.sign(TEST_USER_ID);

    await call(app, "/whoami", bearer(token));
    clock += 60_000;
    await call(app, "/whoami", bearer(token));
    clock += 5 * 60_000;
    await call(app, "/whoami", bearer(token));

    expect(recordSignIn).toHaveBeenCalledTimes(2);
  });

  it("uses X-Organization-Id when the user is a member", async () => {
    const supabase = await testSupabase(() => NOW);
    const token = await supabase.sign(TEST_USER_ID);

    const { status, body } = await call(authApp(await seededStores(), supabase), "/whoami", {
      ...bearer(token),
      "X-Organization-Id": EXAMPLE_ORGANIZATION_ID,
    });

    expect(status).toBe(200);
    expect(body.organizationId).toBe(EXAMPLE_ORGANIZATION_ID);
  });

  it("answers 403 organization_forbidden for an organization the user is not in", async () => {
    const supabase = await testSupabase(() => NOW);

    const { status, body } = await call(authApp(await seededStores(), supabase), "/whoami", {
      ...bearer(await supabase.sign(TEST_USER_ID)),
      "X-Organization-Id": OTHER_ORG_ID,
    });

    expect(status).toBe(403);
    expect(body.code).toBe("organization_forbidden");
  });
});

describe("guards", () => {
  it("requireOrganization refuses a user with no resolved organization", async () => {
    const supabase = await testSupabase(() => NOW);

    const { status, body } = await call(authApp(await seededStores(), supabase), "/org", bearer(await supabase.sign(NEW_USER_ID)));

    expect(status).toBe(403);
    expect(body.code).toBe("organization_required");
  });

  it("requireOrganization lets a user through with their only organization", async () => {
    const supabase = await testSupabase(() => NOW);

    expect((await call(authApp(await seededStores(), supabase), "/org", bearer(await supabase.sign(TEST_USER_ID)))).status).toBe(200);
  });
});
