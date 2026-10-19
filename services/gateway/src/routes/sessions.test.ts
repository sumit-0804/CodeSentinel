import { randomUUID } from "node:crypto";

import { SessionListSchema } from "@code-sentinel/contracts";
import { EXAMPLE_ORGANIZATION_ID } from "@code-sentinel/contracts/examples";
import { withServer } from "@code-sentinel/service-kit/testing";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { seededStores, testAppDeps, TEST_USER_ID } from "../test-support/fixtures.js";
import { stepUpClaims, testSupabase, TEST_SUPABASE_SESSION_ID } from "../test-support/supabase-tokens.js";

const PHONE = randomUUID();
const STRANGER = randomUUID();

async function setup() {
  const seeded = await seededStores((seed) => {
    seed.activeSessionIds.push(PHONE, STRANGER);
    seed.sessions = [
      { sessionId: TEST_SUPABASE_SESSION_ID, userId: TEST_USER_ID, createdAt: new Date("2026-10-19T08:00:00Z"), userAgent: "Firefox" },
      { sessionId: PHONE, userId: TEST_USER_ID, createdAt: new Date("2026-10-10T08:00:00Z"), lastActiveAt: new Date("2026-10-19T09:00:00Z"), ip: "198.51.100.4" },
      { sessionId: STRANGER, userId: randomUUID(), createdAt: new Date("2026-10-10T08:00:00Z") },
    ];
  });
  const supabase = await testSupabase();
  const app = createApp(testAppDeps({ stores: seeded.stores, supabaseVerifier: supabase.verifier }));
  const auth = async (stepUp: boolean) => ({ Authorization: `Bearer ${await supabase.sign(TEST_USER_ID, stepUp ? stepUpClaims() : {})}` });
  return { app, stores: seeded.stores, auth };
}

describe("/v1/me/sessions", () => {
  it("lists the caller's devices, newest activity first, marking this one", async () => {
    const { app, auth } = await setup();

    await withServer(app, async (baseUrl) => {
      const body = SessionListSchema.parse(await (await fetch(`${baseUrl}/v1/me/sessions`, { headers: await auth(false) })).json());
      expect(body.items).toEqual([
        { sessionId: PHONE, createdAt: "2026-10-10T08:00:00.000Z", lastActiveAt: "2026-10-19T09:00:00.000Z", ip: "198.51.100.4", current: false },
        { sessionId: TEST_SUPABASE_SESSION_ID, createdAt: "2026-10-19T08:00:00.000Z", userAgent: "Firefox", current: true },
      ]);
    });
  });

  it("signs another device out with a fresh code, and records it", async () => {
    const { app, auth, stores } = await setup();

    await withServer(app, async (baseUrl) => {
      const refused = await fetch(`${baseUrl}/v1/me/sessions/${PHONE}`, { method: "DELETE", headers: await auth(false) });
      expect([refused.status, ((await refused.json()) as { code: string }).code]).toEqual([403, "mfa_required"]);

      const done = await fetch(`${baseUrl}/v1/me/sessions/${PHONE}`, { method: "DELETE", headers: await auth(true) });
      expect(done.status).toBe(204);
    });
    await expect(stores.sessions.isActive(PHONE)).resolves.toBe(false);
    const events = await stores.audit.listForOrganization(EXAMPLE_ORGANIZATION_ID, { limit: 5 });
    expect(events.map((e) => [e.action, e.targetId])).toEqual([
      ["session_revoked", PHONE],
      ["step_up_refused", undefined],
    ]);
  });

  it("refuses the current session, another user's and nonsense with 409 and 404", async () => {
    const { app, auth, stores } = await setup();

    await withServer(app, async (baseUrl) => {
      const headers = await auth(true);
      const status = async (id: string) => (await fetch(`${baseUrl}/v1/me/sessions/${id}`, { method: "DELETE", headers })).status;
      expect(await status(TEST_SUPABASE_SESSION_ID)).toBe(409);
      expect(await status(STRANGER)).toBe(404);
      expect(await status("not-a-uuid")).toBe(404);
    });
    await expect(stores.sessions.isActive(STRANGER)).resolves.toBe(true);
  });
});
