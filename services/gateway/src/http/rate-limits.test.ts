import { ApiErrorSchema } from "@code-sentinel/contracts";
import { withServer } from "@code-sentinel/service-kit/testing";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { pullRequestEventPayload, seededStores, signedWebhookHeaders, testAppDeps, testConfig, TEST_USER_ID } from "../test-support/fixtures.js";
import { testSupabase } from "../test-support/supabase-tokens.js";
import { DEFAULT_RATE_LIMITS, type RateLimitSettings } from "./rate-limits.js";

async function appWith(limits: Partial<RateLimitSettings>) {
  const seeded = await seededStores();
  const supabase = await testSupabase();
  const app = createApp(
    testAppDeps({ config: testConfig({ rateLimits: { ...DEFAULT_RATE_LIMITS, ...limits } }), stores: seeded.stores, supabaseVerifier: supabase.verifier }),
  );
  return { app, bearer: `Bearer ${await supabase.sign(TEST_USER_ID)}` };
}

async function expectLimited(response: Response) {
  expect(response.status).toBe(429);
  expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(ApiErrorSchema.parse(await response.json()).code).toBe("rate_limited");
}

describe("rate limits (FR-GW-05)", () => {
  it("stops an address after repeated failed sign-ins, and never counts successful ones", async () => {
    const { app, bearer } = await appWith({ failedAuthPer15Minutes: 2 });

    await withServer(app, async (baseUrl) => {
      for (let i = 0; i < 4; i++) expect((await fetch(`${baseUrl}/v1/me`, { headers: { Authorization: bearer } })).status).toBe(200);
      for (let i = 0; i < 2; i++) expect((await fetch(`${baseUrl}/v1/me`)).status).toBe(401);
      await expectLimited(await fetch(`${baseUrl}/v1/me`));
    });
  });

  it("limits each signed-in user, and writes more tightly than reads", async () => {
    const { app, bearer } = await appWith({ userPerMinute: 3, writePerMinute: 1 });
    const headers = { Authorization: bearer, "Content-Type": "application/json" };

    await withServer(app, async (baseUrl) => {
      expect((await fetch(`${baseUrl}/v1/reviews`, { method: "POST", headers, body: "{}" })).status).toBe(400);
      await expectLimited(await fetch(`${baseUrl}/v1/reviews`, { method: "POST", headers, body: "{}" }));
      expect((await fetch(`${baseUrl}/v1/me`, { headers })).status).toBe(200);
      await expectLimited(await fetch(`${baseUrl}/v1/me`, { headers }));
    });
  });

  it("limits webhook deliveries per installation, so one busy installation doesn't block another", async () => {
    const { app } = await appWith({ webhookPerMinute: 2 });
    const deliver = (baseUrl: string, installation: number) => {
      const body = JSON.stringify({ zen: "Keep it logically awesome.", installation: { id: installation } });
      return fetch(`${baseUrl}/webhooks/github`, { method: "POST", headers: signedWebhookHeaders(body, undefined, { event: "ping" }), body });
    };

    await withServer(app, async (baseUrl) => {
      expect((await deliver(baseUrl, 42)).status).toBe(202);
      expect((await deliver(baseUrl, 42)).status).toBe(202);
      await expectLimited(await deliver(baseUrl, 42));
      expect((await deliver(baseUrl, 43)).status).toBe(202);
    });
  });

  it("doesn't count a delivery with a bad signature", async () => {
    const { app } = await appWith({ webhookPerMinute: 1 });
    const body = JSON.stringify(pullRequestEventPayload());

    await withServer(app, async (baseUrl) => {
      for (let i = 0; i < 3; i++) {
        const forged = await fetch(`${baseUrl}/webhooks/github`, { method: "POST", headers: signedWebhookHeaders(body, "wrong-secret-value"), body });
        expect(forged.status).toBe(401);
      }
    });
  });
});
