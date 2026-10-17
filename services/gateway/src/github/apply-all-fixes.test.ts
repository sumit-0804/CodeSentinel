import { describe, expect, it, vi } from "vitest";

import type { CombinedReport, Finding } from "@code-sentinel/contracts";

import type { RepositoryRecord, ReviewRecord, SuggestionRecord } from "../persistence/stores.js";
import { applyAllFixes, commitAllFixes, openFixes } from "./apply-all-fixes.js";
import type { PullRequestInfo } from "./github-client.js";
import { StubGitHubClient } from "./stub-github-client.js";

const HEAD = "a".repeat(40);
const PAY = "import os\nquery = f\"SELECT {c}\"\ncur.execute(query)\nprint('done')\n";
const CART = "var tax  =  0.2\nlet total=1\n";

let next = 0;
const fix = (overrides: Partial<SuggestionRecord> = {}): SuggestionRecord => {
  next++;
  return {
    suggestionId: `${next}`.padStart(8, "1") + "-1111-4111-8111-111111111111",
    findingId: `${next}`.padStart(8, "2") + "-2222-4222-8222-222222222222",
    reviewId: "33333333-3333-4333-8333-333333333333",
    organizationId: "44444444-4444-4444-8444-444444444444",
    repositoryId: "55555555-5555-4555-8555-555555555555",
    prNumber: 4,
    headSha: HEAD,
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
  };
};

const security = () => fix();
const styleTax = () =>
  fix({ agent: "style", ruleId: "style/prettier", title: "Formatting differs from prettier", kind: "deterministic", filePath: "web/cart.js", lineStart: 1, lineEnd: 1, originalSnippet: "var tax  =  0.2", suggestedSnippet: "var tax = 0.2;" });
const styleTotal = () =>
  fix({ agent: "style", ruleId: "style/prettier", title: "Formatting differs from prettier", kind: "deterministic", filePath: "web/cart.js", lineStart: 2, lineEnd: 2, originalSnippet: "let total=1", suggestedSnippet: "let total = 1;" });
const styleOnSqlLine = () =>
  fix({ agent: "style", ruleId: "style/black", kind: "deterministic", lineStart: 3, lineEnd: 3, originalSnippet: "cur.execute(query)", suggestedSnippet: "cur.execute( query )" });

const pull = (overrides: Partial<PullRequestInfo> = {}): PullRequestInfo => ({
  number: 4,
  title: "PR",
  state: "open",
  draft: false,
  headSha: HEAD,
  headRef: "demo/fixes",
  headRepoFullName: "octo/playground",
  baseSha: "b".repeat(40),
  baseRef: "main",
  updatedAt: "2026-10-16T10:00:00Z",
  htmlUrl: "https://github.com/octo/playground/pull/4",
  ...overrides,
});

function github(p = pull()) {
  const g = new StubGitHubClient();
  g.repoFiles.set("app/payments.py", { sha: "blob-1", text: PAY });
  g.repoFiles.set("web/cart.js", { sha: "blob-2", text: CART });
  g.pullRequests.push(p);
  return g;
}

const REF = { installationId: 1, owner: "octo", repo: "playground", pullNumber: 4 };
const commit = (g: StubGitHubClient, fixes: SuggestionRecord[], p = pull()) => commitAllFixes(g, { ref: REF, repositoryFullName: "octo/playground", pull: p, fixes });

describe("commitAllFixes", () => {
  it("commits AI and Style fixes across files in one commit, bottom-up within a file", async () => {
    const g = github();

    const result = await commit(g, [styleTax(), security(), styleTotal()]);

    expect(result).toMatchObject({ ok: true, skipped: [] });
    expect(g.multiCommits).toHaveLength(1);
    expect(g.multiCommits[0]).toMatchObject({ branch: "demo/fixes", parentSha: HEAD, message: "Apply 3 Code Sentinel fixes" });
    expect(g.repoFiles.get("app/payments.py")?.text).toBe("import os\ncur.execute(\"SELECT ?\", (c,))\nprint('done')\n");
    expect(g.repoFiles.get("web/cart.js")?.text).toBe("var tax = 0.2;\nlet total = 1;\n");
  });

  it("keeps the higher-priority fix where two overlap, and skips a fix whose lines changed", async () => {
    const g = github();
    const changed = styleTax();
    changed.originalSnippet = "var tax = 0.3";

    const result = await commit(g, [styleOnSqlLine(), security(), changed, styleTotal()]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied.map((f) => f.agent)).toEqual(["security", "style"]);
    expect(result.skipped.map((s) => s.reason).sort()).toEqual(["file_changed", "overlaps_another_fix"]);
  });

  it("refuses a closed, forked or moved pull request, and a branch that moves while committing", async () => {
    expect(await commit(github(), [security()], pull({ state: "closed" }))).toMatchObject({ ok: false, code: "pull_request_closed" });
    expect(await commit(github(), [security()], pull({ headRepoFullName: "fork/playground" }))).toMatchObject({ ok: false, code: "fork_not_supported" });
    expect(await commit(github(), [security()], pull({ headSha: "c".repeat(40) }))).toMatchObject({ ok: false, code: "head_moved" });

    const racing = github(pull({ headSha: "e".repeat(40) }));
    expect(await commit(racing, [security()])).toMatchObject({ ok: false, code: "head_moved" });
    expect(racing.multiCommits).toEqual([]);
  });

  it("says when nothing could be applied", async () => {
    const stale = security();
    stale.originalSnippet = "gone";
    expect(await commit(github(), [stale])).toMatchObject({ ok: false, code: "nothing_to_apply" });
  });
});

const finding = (s: SuggestionRecord, confidence = 0.9): Finding => ({
  agent: s.agent,
  ruleId: s.ruleId,
  title: s.title,
  description: "d",
  location: { filePath: s.filePath, lineStart: s.lineStart, lineEnd: s.lineEnd },
  severity: "warning",
  confidence,
  suggestion: { kind: s.kind, originalSnippet: s.originalSnippet, suggestedSnippet: s.suggestedSnippet },
});

const report = (findings: Finding[]): CombinedReport => ({
  reviewId: "33333333-3333-4333-8333-333333333333",
  status: "completed",
  summary: { criticalCount: 0, warningCount: 0, infoCount: 0, autoFixedCount: 0, suggestedFixCount: 0 },
  findings,
  agentRuns: [],
});

describe("openFixes", () => {
  it("keeps undecided fixes for the reviewed commit whose finding was posted", () => {
    const posted = security();
    const lowConfidence = styleTax();
    const decided = { ...styleTotal(), state: "accepted" as const };
    const oldCommit = { ...styleOnSqlLine(), headSha: "f".repeat(40) };

    const open = openFixes(report([finding(posted), finding(lowConfidence, 0.5), finding(decided), finding(oldCommit)]), 0.8, HEAD, [posted, lowConfidence, decided, oldCommit]);

    expect(open).toEqual([posted]);
  });
});

describe("applyAllFixes", () => {
  const USER_ID = "77777777-7777-4777-8777-777777777777";
  const repository: RepositoryRecord = {
    repositoryId: "55555555-5555-4555-8555-555555555555",
    organizationId: "44444444-4444-4444-8444-444444444444",
    githubInstallationId: "66666666-6666-4666-8666-666666666666",
    githubInstallationNumber: 1,
    githubRepoId: 7,
    fullName: "octo/playground",
    reviewEnabled: true,
  };

  const reviewOf = (fixes: SuggestionRecord[]): ReviewRecord => ({
    reviewId: "33333333-3333-4333-8333-333333333333",
    organizationId: repository.organizationId,
    repositoryId: repository.repositoryId,
    repositoryFullName: repository.fullName,
    trigger: "github_pull_request",
    prNumber: 4,
    headSha: HEAD,
    status: "completed",
    confidenceThreshold: 0.8,
    createdAt: new Date(),
    report: report(fixes.map((s) => finding(s))),
  });

  it("commits, records each fix as accepted by the user, and comments once with what was applied", async () => {
    const g = github();
    const fixes = [security(), styleTax()];
    const review = reviewOf(fixes);
    const accept = vi.fn(async () => true);

    const outcome = await applyAllFixes(
      { suggestions: { forReview: async () => fixes, accept }, github: g, now: () => new Date("2026-10-16T12:00:00Z") },
      { review, repository, userId: USER_ID, requestedBy: "@octocat (Check Run)" },
    );

    expect(outcome).toMatchObject({ ok: true, applied: 2, aiApplied: 1, skipped: 0 });
    expect(accept).toHaveBeenCalledTimes(2);
    expect(accept).toHaveBeenCalledWith(fixes[0]!.suggestionId, { userId: USER_ID, commitSha: g.multiCommits[0]!.commitSha, at: new Date("2026-10-16T12:00:00Z") });
    expect(g.pullRequestComments).toHaveLength(1);
    expect(g.pullRequestComments[0]!.body).toContain("**Code Sentinel applied 2 fixes (1 AI-suggested)");
    expect(g.pullRequestComments[0]!.body).toContain("as @octocat (Check Run) asked");

    const again = await applyAllFixes({ suggestions: { forReview: async () => [], accept }, github: g, now: () => new Date() }, { review, repository, userId: USER_ID, requestedBy: "x" });
    expect(again).toMatchObject({ ok: false, code: "nothing_to_apply" });
  });

  it("applies only exact fixes for someone with no Code Sentinel account, and says why the AI fixes were left", async () => {
    const g = github();
    const fixes = [security(), styleTax()];
    const accept = vi.fn(async () => true);

    const outcome = await applyAllFixes(
      { suggestions: { forReview: async () => fixes, accept }, github: g, now: () => new Date("2026-10-17T12:00:00Z") },
      { review: reviewOf(fixes), repository, requestedBy: "@stranger (Check Run)" },
    );

    expect(outcome).toMatchObject({ ok: true, applied: 1, aiApplied: 0 });
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith(fixes[1]!.suggestionId, expect.not.objectContaining({ userId: expect.anything() }));
    expect(g.multiCommits[0]!.files.map((f) => f.path)).toEqual([fixes[1]!.filePath]);
    expect(g.pullRequestComments[0]!.body).toContain("**1 AI-suggested fix was not applied.** Whoever clicked has no Code Sentinel account");
  });

  it("commits nothing but explains when only AI fixes are open and nobody here asked", async () => {
    const g = github();
    const fixes = [security()];

    const outcome = await applyAllFixes(
      { suggestions: { forReview: async () => fixes, accept: vi.fn(async () => true) }, github: g, now: () => new Date() },
      { review: reviewOf(fixes), repository, requestedBy: "@stranger (Check Run)" },
    );

    expect(outcome).toMatchObject({ ok: false, code: "nothing_to_apply" });
    expect(g.multiCommits).toHaveLength(0);
    expect(g.pullRequestComments[0]!.body).toContain("**1 AI-suggested fix was not applied.**");
  });
});
