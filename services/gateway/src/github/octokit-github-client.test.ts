import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { OctokitGitHubClient } from "./octokit-github-client.js";

// A throwaway key so @octokit/auth-app can sign its app JWT; GitHub never sees it.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function fakeGitHub() {
  const file = (i: number) => ({ filename: `src/f${i}.py`, status: "modified", patch: `@@ -1 +1 @@\n+x = ${i}`, sha: "abc", additions: 1 });
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    if (url.pathname === "/app/installations/42/access_tokens") {
      expect(auth).toMatch(/^bearer ey/i);
      return json(201, { token: "ghs_installation", expires_at: new Date(Date.now() + 3_600_000).toISOString(), permissions: {}, repository_selection: "selected" });
    }
    expect(auth).toBe("token ghs_installation");
    if (url.pathname === "/repos/octo/playground/pulls/7/files") {
      if (url.searchParams.get("page") === "2") {
        return json(200, [{ filename: "img/logo.png", status: "added" }, { filename: "new/name.py", previous_filename: "old/name.py", status: "renamed", patch: "@@ -1 +1 @@\n+y" }]);
      }
      const next = `<https://api.github.com/repos/octo/playground/pulls/7/files?per_page=100&page=2>; rel="next"`;
      return json(200, Array.from({ length: 100 }, (_, i) => file(i)), { link: next });
    }
    return json(404, { message: "Not Found" });
  });
}

describe("OctokitGitHubClient", () => {
  it("authenticates as the installation, follows every page, and maps the file fields", async () => {
    const fetchImpl = fakeGitHub();
    const github = new OctokitGitHubClient({ appId: 12345, privateKey, fetch: fetchImpl });

    const files = await github.listPullRequestFiles({ installationId: 42, owner: "octo", repo: "playground", pullNumber: 7 });

    expect(files).toHaveLength(102);
    expect(files[0]).toEqual({ filename: "src/f0.py", status: "modified", patch: "@@ -1 +1 @@\n+x = 0" });
    expect(files.slice(100)).toEqual([
      { filename: "img/logo.png", status: "added" },
      { filename: "new/name.py", status: "renamed", patch: "@@ -1 +1 @@\n+y", previousFilename: "old/name.py" },
    ]);
  });

  it("reuses the installation token across calls", async () => {
    const fetchImpl = fakeGitHub();
    const github = new OctokitGitHubClient({ appId: 12345, privateKey, fetch: fetchImpl });
    const ref = { installationId: 42, owner: "octo", repo: "playground", pullNumber: 7 };

    await github.listPullRequestFiles(ref);
    await github.listPullRequestFiles(ref);

    const tokenCalls = fetchImpl.mock.calls.filter(([input]) => String(input).includes("/access_tokens"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("refuses a pull request without an installation id", async () => {
    const github = new OctokitGitHubClient({ appId: 12345, privateKey, fetch: fakeGitHub() });

    await expect(github.listPullRequestFiles({ owner: "octo", repo: "playground", pullNumber: 7 })).rejects.toThrow(/No GitHub App installation/);
  });
});
