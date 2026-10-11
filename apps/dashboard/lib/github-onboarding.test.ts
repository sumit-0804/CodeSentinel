import { describe, expect, it } from "vitest";
import { connectUrl, installUrl, newState, outcomeForGatewayError, stateMatches } from "./github-onboarding";
import { pickOrganization } from "./organization-choice";
import { parseGithubApp } from "./env";

describe("GitHub onboarding state", () => {
  it("makes unguessable states and only accepts the exact one back", () => {
    const state = newState();
    expect(state).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(newState()).not.toBe(state);

    expect(stateMatches(state, state)).toBe(true);
    expect(stateMatches(`${state}x`, state)).toBe(false);
    expect(stateMatches(state, undefined)).toBe(false);
    expect(stateMatches(null, state)).toBe(false);
    expect(stateMatches("", "")).toBe(false);
  });

  it("builds the install and connect URLs with the state", () => {
    expect(installUrl("code-sentinel-mvp", "s/1")).toBe("https://github.com/apps/code-sentinel-mvp/installations/new?state=s%2F1");
    const connect = new URL(connectUrl("Iv23client", "abc", "http://localhost:3001"));
    expect(connect.origin + connect.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(connect.searchParams)).toEqual({
      client_id: "Iv23client",
      state: "abc",
      redirect_uri: "http://localhost:3001/onboarding/github/callback",
    });
  });

  it("maps gateway error codes to what the page explains", () => {
    expect(outcomeForGatewayError("github_account_taken")).toBe("account_taken");
    expect(outcomeForGatewayError("github_code_invalid")).toBe("code_invalid");
    expect(outcomeForGatewayError("github_link_unconfigured")).toBe("unconfigured");
    expect(outcomeForGatewayError(undefined)).toBe("failed");
  });
});

describe("pickOrganization", () => {
  const orgs = [
    { organizationId: "11111111-1111-4111-8111-111111111111", displayName: "octocat", role: "admin" as const },
    { organizationId: "22222222-2222-4222-8222-222222222222", displayName: "octo-org", role: "member" as const },
  ];

  it("uses the cookie's organization only when the user belongs to it", () => {
    expect(pickOrganization(orgs, orgs[1]!.organizationId)).toBe(orgs[1]);
    expect(pickOrganization(orgs, "33333333-3333-4333-8333-333333333333")).toBe(orgs[0]);
    expect(pickOrganization(orgs, undefined)).toBe(orgs[0]);
    expect(pickOrganization([], orgs[0]!.organizationId)).toBeUndefined();
  });
});

describe("parseGithubApp", () => {
  it("is optional, and needs both a slug and a client ID", () => {
    expect(parseGithubApp(undefined, undefined)).toBeUndefined();
    expect(parseGithubApp("code-sentinel-mvp", "Iv23liAbCdEf123456")).toEqual({ slug: "code-sentinel-mvp", clientId: "Iv23liAbCdEf123456" });
    expect(() => parseGithubApp("code-sentinel-mvp", undefined)).toThrow(/GITHUB_APP_CLIENT_ID/);
    expect(() => parseGithubApp("Not A Slug", "Iv23liAbCdEf123456")).toThrow(/GITHUB_APP_SLUG/);
  });
});
