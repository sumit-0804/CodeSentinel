import { describe, expect, it, vi } from "vitest";

import { OctokitGitHubUserClient } from "./github-user-client.js";

const NOW = Date.now();

/** GitHub's OAuth endpoint and the user API, as far as the client reads them. */
function fakeGitHub() {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    // Real responses carry their URL (read by the paginate plugin) and a Date header (token expiry is computed from it).
    const json = (status: number, body: unknown) =>
      Object.defineProperty(
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", date: new Date(NOW).toUTCString() } }),
        "url",
        { value: url.toString() },
      );
    const auth = new Headers(init?.headers).get("authorization") ?? "";

    if (url.host === "github.com" && url.pathname === "/login/oauth/access_token") {
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      expect(body).toMatchObject({ client_id: "Iv23client", client_secret: "secret-0123456789abcdef" });
      if (body.code === "used") return json(200, { error: "bad_verification_code", error_description: "The code passed is incorrect or expired." });
      const suffix = body.grant_type === "refresh_token" ? "2" : "1";
      return json(200, {
        access_token: `ghu_access${suffix}`,
        refresh_token: `ghr_refresh${suffix}`,
        expires_in: 28_800,
        refresh_token_expires_in: 15_811_200,
        token_type: "bearer",
        scope: "",
      });
    }

    expect(auth).toBe("token ghu_access1");
    if (url.pathname === "/user") return json(200, { id: 101, login: "octocat" });
    if (url.pathname === "/user/installations") {
      return json(200, {
        total_count: 3,
        installations: [
          { id: 1, account: { id: 101, login: "octocat", type: "User" }, suspended_at: null },
          { id: 2, account: { id: 900, login: "octo-org", type: "Organization" }, suspended_at: "2026-10-01T00:00:00Z" },
          { id: 3, account: { id: 950, slug: "octo-enterprise", name: "Octo Enterprise" }, suspended_at: null },
        ],
      });
    }
    if (url.pathname === "/user/memberships/orgs/octo-org") return json(200, { state: "active", role: "admin" });
    if (url.pathname === "/user/memberships/orgs/pending-org") return json(200, { state: "pending", role: "member" });
    return json(404, { message: "Not Found" });
  });
}

const client = () => new OctokitGitHubUserClient({ clientId: "Iv23client", clientSecret: "secret-0123456789abcdef", fetch: fakeGitHub() });

describe("OctokitGitHubUserClient", () => {
  it("exchanges a code for an expiring user token and refreshes it", async () => {
    const github = client();

    const tokens = await github.exchangeCode("fresh");
    expect(tokens).toMatchObject({ accessToken: "ghu_access1", refreshToken: "ghr_refresh1" });
    expect(tokens.expiresAt!.getTime()).toBeGreaterThan(NOW + 28_000_000);
    expect(tokens.refreshExpiresAt!.getTime()).toBeGreaterThan(tokens.expiresAt!.getTime());

    await expect(github.refresh("ghr_refresh1")).resolves.toMatchObject({ accessToken: "ghu_access2", refreshToken: "ghr_refresh2" });
  });

  it("rejects a used or expired code", async () => {
    await expect(client().exchangeCode("used")).rejects.toThrow();
  });

  it("reads the user and their installations, skipping enterprise accounts", async () => {
    const github = client();

    await expect(github.getUser("ghu_access1")).resolves.toEqual({ id: 101, login: "octocat" });
    await expect(github.listInstallations("ghu_access1")).resolves.toEqual([
      { id: 1, account: { id: 101, login: "octocat", type: "user" } },
      { id: 2, account: { id: 900, login: "octo-org", type: "organization" }, suspendedAt: new Date("2026-10-01T00:00:00Z") },
    ]);
  });

  it("reads an active org role and treats pending or hidden memberships as unknown", async () => {
    const github = client();

    await expect(github.getOrgRole("ghu_access1", "octo-org")).resolves.toBe("admin");
    await expect(github.getOrgRole("ghu_access1", "pending-org")).resolves.toBeUndefined();
    await expect(github.getOrgRole("ghu_access1", "secret-org")).resolves.toBeUndefined();
  });
});
