import { CurrentUserSchema, GithubLinkResultSchema, InstallationListResponseSchema, RepositoryListResponseSchema } from "@code-sentinel/contracts";
import { SecretBox } from "@code-sentinel/db";
import { withServer } from "@code-sentinel/service-kit/testing";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import type { InstallationRepository } from "../github/github-client.js";
import { InstallationSync } from "../github/installation-sync.js";
import { StubGitHubClient } from "../github/stub-github-client.js";
import { StubGitHubUserClient, type StubGitHubUser } from "../github/stub-github-user-client.js";
import type { InMemoryStores } from "../persistence/in-memory.js";
import { seededStores, testAppDeps } from "../test-support/fixtures.js";
import { testSupabase } from "../test-support/supabase-tokens.js";

const ME = "4a5b6c7d-8e9f-4a0b-8c1d-2e3f4a5b6c7d";
const SOMEONE_ELSE = "5b6c7d8e-9f0a-4b1c-9d2e-3f4a5b6c7d8e";

const repos = (...names: string[]): InstallationRepository[] =>
  names.map((name, i) => ({ id: 1000 + name.length * 31 + i, fullName: name, defaultBranch: "main", isPrivate: true }));

/** "octocat" has their own account installed, and is admin of "octo-org", which is installed too. */
function octocat(overrides: Partial<StubGitHubUser> = {}): StubGitHubUser {
  return {
    code: "code-1",
    id: 101,
    login: "octocat",
    installations: [
      { id: 11, account: { id: 101, login: "octocat", type: "user" } },
      { id: 12, account: { id: 900, login: "octo-org", type: "organization" } },
    ],
    orgRoles: { "octo-org": "admin" },
    ...overrides,
  };
}

async function setup({
  users = [octocat()],
  linkConfigured = true,
  ttlMs,
}: { users?: StubGitHubUser[]; linkConfigured?: boolean; ttlMs?: number } = {}) {
  const { stores, apiKey } = await seededStores();
  const supabase = await testSupabase();
  const github = new StubGitHubClient();
  github.installationRepositories.set(11, repos("octocat/dotfiles"));
  github.installationRepositories.set(12, repos("octo-org/api", "octo-org/web"));
  const githubUsers = new StubGitHubUserClient(users, ttlMs ? { ttlMs } : {});
  const sync = new InstallationSync({
    github,
    githubUsers,
    users: stores.users,
    installations: stores.installations,
    githubTokens: stores.githubTokens,
    secretBox: new SecretBox(Buffer.alloc(32, 7).toString("base64")),
  });
  const app = createApp(
    testAppDeps({
      stores,
      github,
      supabaseVerifier: supabase.verifier,
      ...(linkConfigured ? { githubLink: { githubUsers, sync } } : {}),
    }),
  );

  async function call(method: string, path: string, { as = ME, body, headers = {} }: { as?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    let result!: { status: number; body: Record<string, unknown> };
    // A signed-in session per call; the test seed marks the token's session active.
    const token = as.startsWith("cs_live_") ? as : await supabase.sign(as);
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      result = { status: response.status, body: (await response.json()) as Record<string, unknown> };
    });
    return result;
  }

  return { stores: stores as InMemoryStores, github, githubUsers, apiKey, call };
}

describe("POST /v1/github/link", () => {
  it("links GitHub, syncs every installation with the right roles, and seals the tokens", async () => {
    const { stores, call } = await setup();

    const { status, body } = await call("POST", "/v1/github/link", { body: { code: "code-1" } });

    expect(status).toBe(200);
    const result = GithubLinkResultSchema.parse(body);
    expect(result.githubLogin).toBe("octocat");
    expect(result.installations.map((i) => [i.accountLogin, i.accountType, i.repositoryCount])).toEqual([
      ["octocat", "user", 1],
      ["octo-org", "organization", 2],
    ]);

    const me = CurrentUserSchema.parse((await call("GET", "/v1/me")).body);
    expect(me.githubLogin).toBe("octocat");
    expect(me.organizations.map((o) => [o.displayName, o.role]).sort()).toEqual([
      ["octo-org", "admin"],
      ["octocat", "admin"],
    ]);

    const sealed = await stores.githubTokens.get(ME);
    expect(sealed?.accessTokenSealed).toMatch(/^v1\./);
    expect(JSON.stringify(sealed)).not.toContain("stub-access");
  });

  it("gives member when GitHub won't reveal the org role", async () => {
    const { call } = await setup({ users: [octocat({ orgRoles: {} })] });

    await call("POST", "/v1/github/link", { body: { code: "code-1" } });

    const me = CurrentUserSchema.parse((await call("GET", "/v1/me")).body);
    expect(me.organizations.find((o) => o.displayName === "octo-org")?.role).toBe("member");
  });

  it("answers 400 github_code_invalid for a used code", async () => {
    const { call } = await setup();
    await call("POST", "/v1/github/link", { body: { code: "code-1" } });

    const { status, body } = await call("POST", "/v1/github/link", { body: { code: "code-1" } });

    expect(status).toBe(400);
    expect(body.code).toBe("github_code_invalid");
  });

  it("answers 409 github_account_taken when another user already linked that GitHub account", async () => {
    const { call } = await setup({ users: [octocat(), octocat({ code: "code-2" })] });
    await call("POST", "/v1/github/link", { as: SOMEONE_ELSE, body: { code: "code-1" } });

    const { status, body } = await call("POST", "/v1/github/link", { body: { code: "code-2" } });

    expect(status).toBe(409);
    expect(body.code).toBe("github_account_taken");
  });

  it("rejects a missing code, an API key, and an unconfigured server", async () => {
    const configured = await setup();
    expect((await configured.call("POST", "/v1/github/link", { body: {} })).body.code).toBe("invalid_body");
    expect((await configured.call("POST", "/v1/github/link", { as: configured.apiKey, body: { code: "code-1" } })).body.code).toBe("session_required");

    const unconfigured = await setup({ linkConfigured: false });
    const { status, body } = await unconfigured.call("POST", "/v1/github/link", { body: { code: "code-1" } });
    expect(status).toBe(503);
    expect(body.code).toBe("github_link_unconfigured");
  });
});

describe("POST /v1/installations/sync", () => {
  it("answers 409 github_not_linked before GitHub is linked", async () => {
    const { call } = await setup();

    const { status, body } = await call("POST", "/v1/installations/sync");

    expect(status).toBe(409);
    expect(body.code).toBe("github_not_linked");
  });

  it("picks up a repository GitHub no longer covers", async () => {
    const { github, call } = await setup();
    await call("POST", "/v1/github/link", { body: { code: "code-1" } });
    github.installationRepositories.set(12, repos("octo-org/api"));

    const { status, body } = await call("POST", "/v1/installations/sync");

    expect(status).toBe(200);
    expect(GithubLinkResultSchema.parse(body).installations.find((i) => i.accountLogin === "octo-org")?.repositoryCount).toBe(1);
  });

  it("refreshes a token that is about to expire before using it", async () => {
    const { githubUsers, call } = await setup({ ttlMs: 30_000 });
    await call("POST", "/v1/github/link", { body: { code: "code-1" } });

    expect((await call("POST", "/v1/installations/sync")).status).toBe(200);
    expect(githubUsers.refreshed.length).toBeGreaterThan(0);
  });
});

describe("GET /v1/installations and /v1/repositories", () => {
  it("lists the user's installations and each organization's repositories", async () => {
    const { call } = await setup();
    const linked = GithubLinkResultSchema.parse((await call("POST", "/v1/github/link", { body: { code: "code-1" } })).body);
    const org = linked.installations.find((i) => i.accountLogin === "octo-org")!;

    const installations = InstallationListResponseSchema.parse((await call("GET", "/v1/installations")).body);
    expect(installations.items.map((i) => i.accountLogin)).toEqual(["octo-org", "octocat"]);

    const listed = await call("GET", "/v1/repositories", { headers: { "X-Organization-Id": org.organizationId } });
    expect(RepositoryListResponseSchema.parse(listed.body).items.map((r) => r.fullName)).toEqual(["octo-org/api", "octo-org/web"]);
  });

  it("needs a chosen organization when the user belongs to several", async () => {
    const { call } = await setup();
    await call("POST", "/v1/github/link", { body: { code: "code-1" } });

    const { status, body } = await call("GET", "/v1/repositories");

    expect(status).toBe(403);
    expect(body.code).toBe("organization_required");
  });

  it("serves an API key its own organization's repositories", async () => {
    const { apiKey, call } = await setup();

    const { status, body } = await call("GET", "/v1/repositories", { as: apiKey });

    expect(status).toBe(200);
    expect(RepositoryListResponseSchema.parse(body).items).toHaveLength(1);
  });
});
