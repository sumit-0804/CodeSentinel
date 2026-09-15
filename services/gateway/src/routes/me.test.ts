import { CurrentUserSchema } from "@code-sentinel/contracts";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { seededStores, testAppDeps, TEST_USER_ID, type SeededStores } from "../test-support/fixtures.js";
import { withServer } from "../test-support/with-server.js";

async function getMe(seeded: SeededStores, headers: Record<string, string> = {}) {
  let result!: { status: number; body: Record<string, unknown> };
  await withServer(createApp(testAppDeps({ stores: seeded.stores })), async (baseUrl) => {
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

  it("returns the current user for an API key", async () => {
    const seeded = await seededStores();

    const { status, body } = await getMe(seeded, { Authorization: `Bearer ${seeded.apiKey}` });

    expect(status).toBe(200);
    const user = CurrentUserSchema.parse(body);
    expect(user).toMatchObject({ userId: TEST_USER_ID, githubLogin: "octo-dev" });
    expect(user.organizations).toHaveLength(1);
  });

  it("returns the same user for the session cookie", async () => {
    const seeded = await seededStores();

    const { status, body } = await getMe(seeded, { Cookie: `cs_session=${seeded.sessionToken}` });

    expect(status).toBe(200);
    expect(CurrentUserSchema.parse(body).userId).toBe(TEST_USER_ID);
  });

  it("answers 401 when the credential's user no longer exists", async () => {
    const seeded = await seededStores((seed) => {
      seed.users = [];
    });

    const { status, body } = await getMe(seeded, { Authorization: `Bearer ${seeded.apiKey}` });

    expect(status).toBe(401);
    expect(body.code).toBe("invalid_credentials");
  });
});
