import { describe, expect, it, vi } from "vitest";

import type { SuggestionRecord } from "../persistence/stores.js";
import { applySuggestionToText, commitSuggestion, matchPostedComments } from "./apply-suggestion.js";
import type { PullRequestInfo } from "./github-client.js";
import { StubGitHubClient } from "./stub-github-client.js";

const FILE = "import os\nquery = f\"SELECT {c}\"\ncur.execute(query)\nprint('done')\n";

const fix = (overrides: Partial<SuggestionRecord> = {}): SuggestionRecord => ({
  suggestionId: "11111111-1111-4111-8111-111111111111",
  findingId: "22222222-2222-4222-8222-222222222222",
  reviewId: "33333333-3333-4333-8333-333333333333",
  organizationId: "44444444-4444-4444-8444-444444444444",
  repositoryId: "55555555-5555-4555-8555-555555555555",
  prNumber: 4,
  headSha: "a".repeat(40),
  agent: "security",
  ruleId: "security/sql-injection",
  title: "SQL built from string formatting",
  filePath: "app/payments.py",
  lineStart: 2,
  lineEnd: 3,
  kind: "ai_suggested",
  state: "proposed",
  originalSnippet: "query = f\"SELECT {c}\"\ncur.execute(query)\n",
  suggestedSnippet: "cur.execute(\"SELECT ?\", (c,))",
  ...overrides,
});

describe("applySuggestionToText", () => {
  it("replaces the reviewed lines with the fix, which may have fewer lines", () => {
    expect(applySuggestionToText(FILE, fix())).toBe("import os\ncur.execute(\"SELECT ?\", (c,))\nprint('done')\n");
  });

  it("keeps Windows line endings", () => {
    const crlf = FILE.replace(/\n/g, "\r\n");
    expect(applySuggestionToText(crlf, fix())).toBe("import os\r\ncur.execute(\"SELECT ?\", (c,))\r\nprint('done')\r\n");
  });

  it("handles the last line of a file without a trailing newline, and multi-line fixes", () => {
    const text = "a\nb\nlast = 1";
    expect(applySuggestionToText(text, fix({ lineStart: 3, lineEnd: 3, originalSnippet: "last = 1", suggestedSnippet: "last = 2\nnext = 3\n" }))).toBe(
      "a\nb\nlast = 2\nnext = 3",
    );
  });

  it("refuses when the lines no longer match or are out of range", () => {
    expect(applySuggestionToText(FILE.replace("SELECT", "select"), fix())).toBeUndefined();
    expect(applySuggestionToText(FILE, fix({ lineStart: 40, lineEnd: 41 }))).toBeUndefined();
  });
});

describe("matchPostedComments", () => {
  it("pairs fixes with comments by file and line range, using each comment once", () => {
    const a = fix({ suggestionId: "a" });
    const b = fix({ suggestionId: "b" });
    const c = fix({ suggestionId: "c", filePath: "web/cart.js", lineStart: 6, lineEnd: 6 });

    const matched = matchPostedComments([a, b, c], [
      { id: 10, path: "app/payments.py", line: 3, startLine: 2 },
      { id: 11, path: "app/payments.py", line: 3, startLine: 2 },
      { id: 12, path: "web/cart.js", line: 6 },
      { id: 13, path: "web/other.js", line: 1 },
    ]);

    expect(matched).toEqual([
      { suggestionId: "a", commentId: 10 },
      { suggestionId: "b", commentId: 11 },
      { suggestionId: "c", commentId: 12 },
    ]);
  });
});

describe("commitSuggestion", () => {
  const pull = (overrides: Partial<PullRequestInfo> = {}): PullRequestInfo => ({
    number: 4,
    title: "PR",
    state: "open",
    draft: false,
    headSha: "a".repeat(40),
    headRef: "demo/db-check",
    headRepoFullName: "octo/playground",
    baseSha: "b".repeat(40),
    baseRef: "main",
    updatedAt: "2026-10-14T10:00:00Z",
    htmlUrl: "https://github.com/octo/playground/pull/4",
    ...overrides,
  });
  const REF = { installationId: 1, owner: "octo", repo: "playground" };
  const commit = (github: StubGitHubClient, p = pull(), suggestion = fix()) =>
    commitSuggestion(github, { ref: REF, repositoryFullName: "octo/playground", pull: p, suggestion });

  it("commits the fixed file onto the pull request branch", async () => {
    const github = new StubGitHubClient();
    github.repoFiles.set("app/payments.py", { sha: "blob-1", text: FILE });

    const result = await commit(github);

    expect(result).toEqual({ ok: true, commitSha: github.commits[0]!.commitSha });
    expect(github.commits[0]).toMatchObject({ path: "app/payments.py", blobSha: "blob-1", branch: "demo/db-check", message: "Apply Code Sentinel fix: SQL built from string formatting" });
    expect(github.commits[0]!.text).toContain("cur.execute(\"SELECT ?\", (c,))");
  });

  it("refuses a closed pull request, a fork, a moved head and changed lines, without committing", async () => {
    const github = new StubGitHubClient();
    github.repoFiles.set("app/payments.py", { sha: "blob-1", text: FILE.replace("SELECT", "select") });

    expect(await commit(github, pull({ state: "closed" }))).toMatchObject({ ok: false, code: "pull_request_closed" });
    expect(await commit(github, pull({ headRepoFullName: "someone/fork" }))).toMatchObject({ ok: false, code: "fork_not_supported" });
    expect(await commit(github, pull({ headSha: "d".repeat(40) }))).toMatchObject({ ok: false, code: "head_moved" });
    expect(await commit(github)).toMatchObject({ ok: false, code: "file_changed" });
    expect(github.commits).toEqual([]);
  });

  it("explains a missing Contents permission, and rethrows a GitHub outage", async () => {
    const github = new StubGitHubClient();
    github.repoFiles.set("app/payments.py", { sha: "blob-1", text: FILE });
    vi.spyOn(github, "updateFile").mockRejectedValueOnce(Object.assign(new Error("Resource not accessible by integration"), { status: 403 }));
    expect(await commit(github)).toMatchObject({ ok: false, code: "github_permission_missing" });

    vi.spyOn(github, "updateFile").mockRejectedValueOnce(Object.assign(new Error("down"), { status: 502 }));
    await expect(commit(github)).rejects.toThrow("down");
  });
});
