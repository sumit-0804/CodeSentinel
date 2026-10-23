import { randomUUID } from "node:crypto";

import { RepositoryConfigSchema, ReviewDefaultsSchema } from "@code-sentinel/contracts";
import { EXAMPLE_ORGANIZATION_ID, EXAMPLE_REPOSITORY_ID } from "@code-sentinel/contracts/examples";
import { withServer } from "@code-sentinel/service-kit/testing";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import type { StoreSeed } from "../persistence/in-memory.js";
import { seededStores, testAppDeps, TEST_USER_ID } from "../test-support/fixtures.js";
import { stepUpClaims, testSupabase } from "../test-support/supabase-tokens.js";

/** `member` can open the seeded repository on GitHub; `outsider` is a member who can't. */
type Caller = "admin" | "member" | "outsider";

/** Calls the gateway as the seeded admin (Supabase session, stepped up unless `stepUp: false`) or as a plain member. */
async function call(
  method: string,
  path: string,
  { as = "admin", body, edit, stepUp = true }: { as?: Caller; body?: unknown; edit?: (seed: StoreSeed) => void; stepUp?: boolean | "stale" } = {},
) {
  // "stale": the admin has an authenticator app and entered a code an hour ago, too old for a write.
  const seeded = await seededStores((seed) => {
    if (stepUp === "stale") seed.authenticatorUserIds = [TEST_USER_ID];
    if (as !== "admin") seed.users[0]!.memberships[0]!.role = "member";
    if (as === "member") seed.repositoryMembers = [{ repositoryId: EXAMPLE_REPOSITORY_ID, userId: TEST_USER_ID }];
    edit?.(seed);
  });
  const supabase = await testSupabase();
  const authorization = await supabase.sign(TEST_USER_ID, stepUp === "stale" ? stepUpClaims(3600) : stepUp ? stepUpClaims() : {});
  let result!: { status: number; body: Record<string, unknown> };
  await withServer(createApp(testAppDeps({ stores: seeded.stores, supabaseVerifier: supabase.verifier })), async (baseUrl) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${authorization}`, "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    result = { status: response.status, body: (await response.json()) as Record<string, unknown> };
  });
  return { ...result, stores: seeded.stores };
}

const CONFIG_PATH = `/v1/repositories/${EXAMPLE_REPOSITORY_ID}/config`;
const DEFAULTS_PATH = `/v1/organizations/${EXAMPLE_ORGANIZATION_ID}/review-defaults`;

describe("GET /v1/repositories/{id}/config", () => {
  it("returns the platform defaults with their sources, even to a member", async () => {
    const { status, body } = await call("GET", CONFIG_PATH, { as: "member", stepUp: false });

    expect(status).toBe(200);
    const config = RepositoryConfigSchema.parse(body);
    expect(config).toMatchObject({ useOrgDefaults: true, reviewBranches: [], effectiveReviewBranches: ["main"], thresholdSource: "platform_default" });
    expect(config.agents[0]).toEqual({ agent: "security", mode: "block", source: "platform_default" });
    expect(config.agents.slice(1).every(({ mode }) => mode === "comment")).toBe(true);
  });

  it("answers 404 for an unknown repository or one in another organization", async () => {
    expect((await call("GET", `/v1/repositories/${randomUUID()}/config`)).status).toBe(404);
    const other = await call("GET", CONFIG_PATH, {
      edit: (seed) => {
        seed.repositories[0]!.organizationId = randomUUID();
      },
    });
    expect(other.status).toBe(404);
    expect(other.body.code).toBe("repository_not_found");
  });

  it("answers 404 to a member who can't open the repository on GitHub, and leaves it out of their list", async () => {
    const outsider = await call("GET", CONFIG_PATH, { as: "outsider", stepUp: false });
    expect([outsider.status, outsider.body.code]).toEqual([404, "repository_not_found"]);

    expect((await call("GET", "/v1/repositories", { as: "outsider", stepUp: false })).body.items).toEqual([]);
    expect((await call("GET", "/v1/repositories", { as: "member", stepUp: false })).body.items).toMatchObject([{ repositoryId: EXAMPLE_REPOSITORY_ID }]);
  });
});

describe("PUT /v1/repositories/{id}/config", () => {
  it("saves modes, branches and the threshold for an admin and returns the new configuration", async () => {
    const update = {
      useOrgDefaults: false,
      agents: [
        { agent: "security", mode: "comment" },
        { agent: "logic", mode: "block" },
      ],
      reviewBranches: ["main", "release/*"],
      confidenceThresholdOverride: 0.9,
    };

    const { status, body, stores } = await call("PUT", CONFIG_PATH, { body: update });

    expect(status).toBe(200);
    expect(RepositoryConfigSchema.parse(body)).toMatchObject({
      useOrgDefaults: false,
      effectiveReviewBranches: ["main", "release/*"],
      effectiveConfidenceThreshold: 0.9,
      thresholdSource: "repository_override",
      updatedBy: TEST_USER_ID,
    });
    await expect(stores.repositoryConfig.getEffectiveConfig(EXAMPLE_REPOSITORY_ID)).resolves.toMatchObject({ blockingAgents: ["logic"] });
  });

  it("refuses a member with 403 admin_required", async () => {
    // A member is told about the role first, without being asked for a code.
    const member = await call("PUT", CONFIG_PATH, { as: "member", body: { reviewEnabled: false }, stepUp: false });

    expect([member.status, member.body.code]).toEqual([403, "admin_required"]);
  });

  it("needs a fresh TOTP step-up once an authenticator is set up: a stale code gets 403 mfa_required and nothing changes", async () => {
    const { status, body, stores } = await call("PUT", CONFIG_PATH, { body: { reviewEnabled: false }, stepUp: "stale" });

    expect([status, body.code]).toEqual([403, "mfa_required"]);
    await expect(stores.repositoryConfig.getConfigInputs(EXAMPLE_REPOSITORY_ID)).resolves.toMatchObject({ reviewEnabled: true });
  });

  it("saves without any code for an admin who hasn't set up an authenticator app", async () => {
    const { status, body } = await call("PUT", CONFIG_PATH, { body: { reviewEnabled: false }, stepUp: false });

    expect(status).toBe(200);
    expect(body).toMatchObject({ reviewEnabled: false });
  });

  it("rejects turning every agent off with 400 no_agents_enabled", async () => {
    const agents = ["security", "style", "performance", "logic", "documentation"].map((agent) => ({ agent, mode: "off" }));

    const { status, body } = await call("PUT", CONFIG_PATH, { body: { useOrgDefaults: false, agents } });

    expect([status, body.code]).toEqual([400, "no_agents_enabled"]);
  });

  it("saves branches for a repository that keeps following the organization defaults", async () => {
    const { status, body } = await call("PUT", CONFIG_PATH, { body: { reviewBranches: ["develop"] } });

    expect(status).toBe(200);
    expect(RepositoryConfigSchema.parse(body)).toMatchObject({ useOrgDefaults: true, reviewBranches: ["develop"], effectiveReviewBranches: ["develop"] });
  });

  it("rejects an invalid branch pattern with 400 invalid_body", async () => {
    const { status, body } = await call("PUT", CONFIG_PATH, { body: { reviewBranches: ["../main"] } });

    expect([status, body.code]).toEqual([400, "invalid_body"]);
  });
});

describe("/v1/organizations/{id}/review-defaults", () => {
  it("reads and updates the defaults a following repository then uses", async () => {
    const update = { agents: [{ agent: "security", mode: "comment" }], confidenceThreshold: 0.7 };

    const { status, body, stores } = await call("PUT", DEFAULTS_PATH, { body: update });

    expect(status).toBe(200);
    expect(ReviewDefaultsSchema.parse(body)).toMatchObject({ confidenceThreshold: 0.7 });
    expect(body).not.toHaveProperty("reviewBranches");
    expect(ReviewDefaultsSchema.parse(body).agents[0]).toEqual({ agent: "security", mode: "comment", source: "organization_default" });
    await expect(stores.repositoryConfig.getEffectiveConfig(EXAMPLE_REPOSITORY_ID)).resolves.toMatchObject({
      blockingAgents: [],
      reviewBranches: ["main"],
      confidenceThreshold: 0.7,
    });
  });

  it("answers 404 to a non-member and 403 to a member who isn't an admin", async () => {
    expect((await call("GET", `/v1/organizations/${randomUUID()}/review-defaults`)).status).toBe(404);
    const member = await call("PUT", DEFAULTS_PATH, { as: "member", body: { confidenceThreshold: 0.5 }, stepUp: false });
    expect([member.status, member.body.code]).toEqual([403, "admin_required"]);
    expect((await call("GET", DEFAULTS_PATH, { as: "member" })).status).toBe(200);
  });

  it("needs a TOTP step-up to save, but not to read", async () => {
    const put = await call("PUT", DEFAULTS_PATH, { body: { confidenceThreshold: 0.5 }, stepUp: "stale" });
    expect([put.status, put.body.code]).toEqual([403, "mfa_required"]);
    expect((await call("GET", DEFAULTS_PATH, { stepUp: "stale" })).status).toBe(200);
  });

  it("rejects defaults with every agent off", async () => {
    const agents = ["security", "style", "performance", "logic", "documentation"].map((agent) => ({ agent, mode: "off" }));

    const { status, body } = await call("PUT", DEFAULTS_PATH, { body: { agents } });

    expect([status, body.code]).toEqual([400, "no_agents_enabled"]);
  });
});
