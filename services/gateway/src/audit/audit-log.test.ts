import { AuditEventListSchema } from "@code-sentinel/contracts";
import { EXAMPLE_ORGANIZATION_ID, EXAMPLE_REPOSITORY_ID } from "@code-sentinel/contracts/examples";
import { captureLogger, withServer } from "@code-sentinel/service-kit/testing";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import { seededStores, testAppDeps, testConfig, TEST_USER_ID } from "../test-support/fixtures.js";
import { stepUpClaims, testSupabase } from "../test-support/supabase-tokens.js";

const CONFIG_PATH = `/v1/repositories/${EXAMPLE_REPOSITORY_ID}/config`;
const AUDIT_PATH = `/v1/organizations/${EXAMPLE_ORGANIZATION_ID}/audit-events`;
const BROWSER = "Mozilla/5.0 (Windows NT 10.0) Firefox/131.0";

async function setup({ role = "admin" as "admin" | "member" } = {}) {
  const seeded = await seededStores((seed) => {
    seed.users[0]!.memberships[0]!.role = role;
  });
  const supabase = await testSupabase();
  const { logger, lines } = captureLogger();
  const app = createApp(testAppDeps({ stores: seeded.stores, supabaseVerifier: supabase.verifier, logger }));
  const headers = async (stepUp: boolean) => ({
    Authorization: `Bearer ${await supabase.sign(TEST_USER_ID, stepUp ? stepUpClaims() : {})}`,
    "Content-Type": "application/json",
    "User-Agent": BROWSER,
  });
  return { app, stores: seeded.stores, lines, headers };
}

describe("audit log (WP6)", () => {
  it("records a configuration change with who, from where, and what changed, and admins read it back", async () => {
    const { app, headers, lines } = await setup();

    await withServer(app, async (baseUrl) => {
      const put = await fetch(`${baseUrl}${CONFIG_PATH}`, { method: "PUT", headers: await headers(true), body: JSON.stringify({ confidenceThresholdOverride: 0.7 }) });
      expect(put.status).toBe(200);

      const response = await fetch(`${baseUrl}${AUDIT_PATH}`, { headers: await headers(false) });
      expect(response.status).toBe(200);
      const { items } = AuditEventListSchema.parse(await response.json());
      expect(items).toMatchObject([
        {
          action: "repository_config_updated",
          userId: TEST_USER_ID,
          actor: "Ada Lovelace",
          targetType: "repository",
          targetId: EXAMPLE_REPOSITORY_ID,
          ip: expect.stringMatching(/127\.0\.0\.1$/),
          userAgent: BROWSER,
          metadata: { changed: ["confidenceThresholdOverride"] },
        },
      ]);
    });
    expect(lines.find((line) => line.path === CONFIG_PATH)).toMatchObject({ userId: TEST_USER_ID, userAgent: BROWSER, sessionId: expect.any(String) });
  });

  it("records the browser's IP the dashboard forwards, when TRUST_PROXY counts the dashboard", async () => {
    const seeded = await seededStores();
    const supabase = await testSupabase();
    const app = createApp(testAppDeps({ config: testConfig({ trustProxy: 1 }), stores: seeded.stores, supabaseVerifier: supabase.verifier }));

    await withServer(app, async (baseUrl) => {
      const put = await fetch(`${baseUrl}${CONFIG_PATH}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${await supabase.sign(TEST_USER_ID, stepUpClaims())}`, "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.9" },
        body: JSON.stringify({ autoFixStyle: true }),
      });
      expect(put.status).toBe(200);
    });
    await expect(seeded.stores.audit.listForOrganization(EXAMPLE_ORGANIZATION_ID, { limit: 1 })).resolves.toMatchObject([{ ip: "203.0.113.9" }]);
  });

  it("records a write refused for want of a fresh authenticator code, and still answers 403", async () => {
    const { app, headers, stores } = await setup();

    await withServer(app, async (baseUrl) => {
      const put = await fetch(`${baseUrl}${CONFIG_PATH}`, { method: "PUT", headers: await headers(false), body: JSON.stringify({ reviewEnabled: false }) });
      expect(put.status).toBe(403);
    });
    await expect(stores.audit.listForOrganization(EXAMPLE_ORGANIZATION_ID, { limit: 5 })).resolves.toMatchObject([
      { action: "step_up_refused", metadata: { method: "PUT", path: CONFIG_PATH } },
    ]);
  });

  it("names a reviews switch as such, and pages with before", async () => {
    const { app, headers } = await setup();

    await withServer(app, async (baseUrl) => {
      for (const reviewEnabled of [false, true]) {
        await fetch(`${baseUrl}${CONFIG_PATH}`, { method: "PUT", headers: await headers(true), body: JSON.stringify({ reviewEnabled }) });
      }
      const first = AuditEventListSchema.parse(await (await fetch(`${baseUrl}${AUDIT_PATH}?limit=1`, { headers: await headers(false) })).json());
      expect(first.items).toMatchObject([{ action: "repository_reviews_toggled", metadata: { reviewEnabled: true } }]);
      expect(first.nextBefore).toBeDefined();

      const second = AuditEventListSchema.parse(await (await fetch(`${baseUrl}${AUDIT_PATH}?limit=1&before=${first.nextBefore}`, { headers: await headers(false) })).json());
      expect(second.items).toMatchObject([{ metadata: { reviewEnabled: false } }]);
    });
  });

  it("keeps the audit log for admins", async () => {
    const { app, headers } = await setup({ role: "member" });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}${AUDIT_PATH}`, { headers: await headers(false) });
      expect(response.status).toBe(403);
      expect(((await response.json()) as { code: string }).code).toBe("admin_required");
      expect((await fetch(`${baseUrl}/v1/organizations/${crypto.randomUUID()}/audit-events`, { headers: await headers(false) })).status).toBe(404);
    });
  });

  it("never fails the action when the audit write fails", async () => {
    const { app, headers, stores, lines } = await setup();
    vi.spyOn(stores.audit, "record").mockRejectedValue(new Error("database down"));

    await withServer(app, async (baseUrl) => {
      const put = await fetch(`${baseUrl}${CONFIG_PATH}`, { method: "PUT", headers: await headers(true), body: JSON.stringify({ confidenceThresholdOverride: 0.75 }) });
      expect(put.status).toBe(200);
    });
    expect(lines.some((line) => line.message === "audit event not recorded")).toBe(true);
  });
});
