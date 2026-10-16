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
    if (url.pathname === "/repos/octo/playground/branches") {
      const page = Number(url.searchParams.get("page") ?? "1");
      const next = `<https://api.github.com/repos/octo/playground/branches?per_page=100&page=${page + 1}>; rel="next"`;
      return json(200, Array.from({ length: 100 }, (_, i) => ({ name: `b${page}-${i}` })), { link: next });
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

  it("stops paging branches once the limit is reached", async () => {
    const fetchImpl = fakeGitHub();
    const github = new OctokitGitHubClient({ appId: 12345, privateKey, fetch: fetchImpl });

    const names = await github.listBranches({ installationId: 42, owner: "octo", repo: "playground" }, 150);

    expect([names.length, names[0], names[149]]).toEqual([150, "b1-0", "b2-49"]);
    expect(fetchImpl.mock.calls.filter(([input]) => String(input).includes("/branches"))).toHaveLength(2);
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

  it("creates a Check Run, completes it with annotations in batches of 50, and posts a COMMENT review", async () => {
    const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/access_tokens")) {
        return json(201, { token: "ghs_installation", expires_at: new Date(Date.now() + 3_600_000).toISOString(), permissions: {}, repository_selection: "selected" });
      }
      calls.push({ method: init?.method ?? "GET", path: url.pathname, body: JSON.parse(String(init?.body ?? "{}")) });
      return url.pathname.endsWith("/check-runs") ? json(201, { id: 777 }) : json(200, {});
    });
    const github = new OctokitGitHubClient({ appId: 12345, privateKey, fetch: fetchImpl });
    const ref = { installationId: 42, owner: "octo", repo: "playground", pullNumber: 7 };
    const annotations = Array.from({ length: 51 }, (_, i) => ({ path: "a.py", startLine: i + 1, endLine: i + 1, level: "notice" as const, title: "t", message: "m" }));

    const id = await github.createCheckRun(ref, { name: "Code-Sentinel", headSha: "abc" });
    await github.completeCheckRun(ref, id, { conclusion: "failure", output: { title: "1 critical", summary: "s", annotations } });
    await github.createReview(ref, { commitId: "abc", body: "b", comments: [{ path: "a.py", line: 7, startLine: 6, body: "x" }, { path: "a.py", line: 3, body: "y" }] });

    expect(id).toBe(777);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /repos/octo/playground/check-runs",
      "PATCH /repos/octo/playground/check-runs/777",
      "PATCH /repos/octo/playground/check-runs/777",
      "POST /repos/octo/playground/pulls/7/reviews",
    ]);
    expect(calls[0]!.body).toMatchObject({ name: "Code-Sentinel", head_sha: "abc", status: "in_progress" });
    expect(calls[1]!.body).toMatchObject({ status: "completed", conclusion: "failure", output: { title: "1 critical", summary: "s" } });
    expect((calls[1]!.body.output as { annotations: unknown[] }).annotations).toHaveLength(50);
    expect(calls[2]!.body).not.toHaveProperty("conclusion");
    expect((calls[2]!.body.output as { annotations: unknown[] }).annotations).toEqual([
      { path: "a.py", start_line: 51, end_line: 51, annotation_level: "notice", title: "t", message: "m" },
    ]);
    expect(calls[3]!.body).toEqual({
      commit_id: "abc",
      event: "COMMENT",
      body: "b",
      comments: [
        { path: "a.py", line: 7, side: "RIGHT", start_line: 6, start_side: "RIGHT", body: "x" },
        { path: "a.py", line: 3, side: "RIGHT", body: "y" },
      ],
    });
  });

  it("commits several files as one commit on the head, keeping modes, and adds a Check Run button", async () => {
    const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/access_tokens")) {
        return json(201, { token: "ghs_installation", expires_at: new Date(Date.now() + 3_600_000).toISOString(), permissions: {}, repository_selection: "selected" });
      }
      calls.push({ method: init?.method ?? "GET", path: `${url.pathname}${url.search}`, body: JSON.parse(String(init?.body ?? "{}")) });
      if (url.pathname.endsWith("/git/trees/head1")) return json(200, { sha: "tree0", tree: [{ path: "bin/run.sh", mode: "100755" }, { path: "a.py", mode: "100644" }] });
      if (url.pathname.endsWith("/git/trees")) return json(201, { sha: "tree1" });
      if (url.pathname.endsWith("/git/commits")) return json(201, { sha: "commit1" });
      return json(200, {});
    });
    const github = new OctokitGitHubClient({ appId: 12345, privateKey, fetch: fetchImpl });
    const ref = { installationId: 42, owner: "octo", repo: "playground", pullNumber: 7 };

    const sha = await github.commitFiles(ref, { branch: "feature/x", parentSha: "head1", message: "Apply 2 fixes", files: [{ path: "a.py", text: "a" }, { path: "bin/run.sh", text: "b" }] });
    await github.completeCheckRun(ref, 9, { conclusion: "success", output: { title: "t", summary: "s", annotations: [] }, actions: [{ label: "Apply all fixes", identifier: "apply_all", description: "2 fixes in one commit" }] });
    await github.commentOnPullRequest(ref, "done");

    expect(sha).toBe("commit1");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /repos/octo/playground/git/trees/head1?recursive=1",
      "POST /repos/octo/playground/git/trees",
      "POST /repos/octo/playground/git/commits",
      // Octokit encodes the ref's slashes; GitHub decodes them.
      "PATCH /repos/octo/playground/git/refs/heads%2Ffeature%2Fx",
      "PATCH /repos/octo/playground/check-runs/9",
      "POST /repos/octo/playground/issues/7/comments",
    ]);
    expect(calls[1]!.body).toEqual({
      base_tree: "tree0",
      tree: [
        { path: "a.py", mode: "100644", type: "blob", content: "a" },
        { path: "bin/run.sh", mode: "100755", type: "blob", content: "b" },
      ],
    });
    expect(calls[2]!.body).toEqual({ message: "Apply 2 fixes", tree: "tree1", parents: ["head1"] });
    expect(calls[3]!.body).toEqual({ sha: "commit1", force: false });
    expect(calls[4]!.body).toMatchObject({ actions: [{ label: "Apply all fixes", identifier: "apply_all", description: "2 fixes in one commit" }] });
  });

  it("lists every repository an installation covers, across pages", async () => {
    const repo = (id: number, extra: Record<string, unknown> = {}) => ({ id, full_name: `octo/r${id}`, private: true, default_branch: "main", language: "Python", ...extra });
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      // Real responses carry their URL; the paginate plugin reads it.
      const reply = (body: unknown, headers: Record<string, string> = {}) =>
        Object.defineProperty(json(200, body, headers), "url", { value: url.toString() });
      if (url.pathname === "/app/installations/42/access_tokens") {
        return json(201, { token: "ghs_installation", expires_at: new Date(Date.now() + 3_600_000).toISOString(), permissions: {}, repository_selection: "selected" });
      }
      if (url.pathname === "/installation/repositories" && url.searchParams.get("page") === "2") {
        return reply({ total_count: 2, repositories: [repo(2, { private: false, default_branch: "trunk", language: null })] });
      }
      if (url.pathname === "/installation/repositories") {
        const next = `<https://api.github.com/installation/repositories?per_page=100&page=2>; rel="next"`;
        return reply({ total_count: 2, repositories: [repo(1)] }, { link: next });
      }
      return json(404, { message: "Not Found" });
    });
    const github = new OctokitGitHubClient({ appId: 12345, privateKey, fetch: fetchImpl });

    await expect(github.listInstallationRepositories(42)).resolves.toEqual([
      { id: 1, fullName: "octo/r1", defaultBranch: "main", isPrivate: true, language: "Python" },
      { id: 2, fullName: "octo/r2", defaultBranch: "trunk", isPrivate: false },
    ]);
  });
});
