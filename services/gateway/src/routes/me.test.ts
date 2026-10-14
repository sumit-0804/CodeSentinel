import { CurrentUserSchema } from "@code-sentinel/contracts";
import { withServer } from "@code-sentinel/service-kit/testing";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import { seededStores, testAppDeps, TEST_USER_ID, type SeededStores } from "../test-support/fixtures.js";
import { testSupabase, type TestSupabase } from "../test-support/supabase-tokens.js";

async function getMe(seeded: SeededStores, headers: Record<string, string> = {}, supabase?: TestSupabase) {
  let result!: { status: number; body: Record<string, unknown> };
  const deps = testAppDeps({ stores: seeded.stores, ...(supabase ? { supabaseVerifier: supabase.verifier } : {}) });
  await withServer(createApp(deps), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/me`, { headers });
    result = { status: response.status, body: (await response.json()) as Record<string, unknown> };
  });
  return result;
}

describe("GET /v1/me", () => {
  it("answers 401 unauthenticated without a token", async () => {
    const { status, body } = await getMe(await seededStores());

    expect(status).toBe(401);
    expect(body.code).toBe("unauthenticated");
  });

  it("returns the signed-in user with memberships, name and linked sign-in methods", async () => {
    const seeded = await seededStores();
    const supabase = await testSupabase();

    const { status, body } = await getMe(seeded, { Authorization: `Bearer ${await supabase.sign(TEST_USER_ID)}` }, supabase);

    expect(status).toBe(200);
    const user = CurrentUserSchema.parse(body);
    expect(user).toMatchObject({
      userId: TEST_USER_ID,
      githubLogin: "octo-dev",
      name: "Ada Lovelace",
      providers: ["email", "github"],
    });
    expect(user.organizations).toHaveLength(1);
  });

  it("omits githubLogin for a user who has not linked GitHub", async () => {
    const seeded = await seededStores((seed) => {
      delete seed.users[0]!.githubLogin;
    });
    const supabase = await testSupabase();

    const { status, body } = await getMe(seeded, { Authorization: `Bearer ${await supabase.sign(TEST_USER_ID)}` }, supabase);

    expect(status).toBe(200);
    expect(CurrentUserSchema.parse(body).userId).toBe(TEST_USER_ID);
    expect(body).not.toHaveProperty("githubLogin");
  });

  it("answers 401 when the token's user no longer exists", async () => {
    const seeded = await seededStores();
    vi.spyOn(seeded.stores.users, "findById").mockResolvedValue(undefined);
    const supabase = await testSupabase();

    const { status, body } = await getMe(seeded, { Authorization: `Bearer ${await supabase.sign(TEST_USER_ID)}` }, supabase);

    expect(status).toBe(401);
    expect(body.code).toBe("invalid_credentials");
  });
});
