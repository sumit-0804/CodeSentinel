import { randomUUID } from "node:crypto";

import { SuggestionDecisionSchema } from "@code-sentinel/contracts";
import { EXAMPLE_ORGANIZATION_ID, EXAMPLE_REPOSITORY_ID } from "@code-sentinel/contracts/examples";
import { withServer } from "@code-sentinel/service-kit/testing";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import type { PullRequestInfo } from "../github/github-client.js";
import { StubGitHubClient } from "../github/stub-github-client.js";
import type { SeedSuggestion, StoreSeed } from "../persistence/in-memory.js";
import { seededStores, testAppDeps, TEST_USER_ID } from "../test-support/fixtures.js";
import { stepUpClaims, testSupabase } from "../test-support/supabase-tokens.js";

const HEAD = "a".repeat(40);
const REVIEW_ID = randomUUID();
const FINDING_ID = randomUUID();
const FILE = "import os\nquery = f\"SELECT {c}\"\ncur.execute(query)\n";

const suggestion = (overrides: Partial<SeedSuggestion> = {}): SeedSuggestion => ({
  suggestionId: randomUUID(),
  findingId: FINDING_ID,
  reviewId: REVIEW_ID,
  agent: "security",
  ruleId: "security/sql-injection",
  title: "SQL built from string formatting",
  filePath: "app/payments.py",
  lineStart: 2,
  lineEnd: 3,
  kind: "ai_suggested",
  state: "proposed",
  originalSnippet: "query = f\"SELECT {c}\"\ncur.execute(query)",
  suggestedSnippet: "cur.execute(\"SELECT ?\", (c,))",
  githubCommentId: 5550,
  ...overrides,
});

const pull = (overrides: Partial<PullRequestInfo> = {}): PullRequestInfo => ({
  number: 42,
  title: "Retry failed payments",
  state: "open",
  draft: false,
  headSha: HEAD,
  headRef: "fix/retry",
  headRepoFullName: "code-sentinel/consumer-api",
  baseSha: "b".repeat(40),
  baseRef: "main",
  updatedAt: "2026-10-14T10:00:00Z",
  htmlUrl: "https://github.com/code-sentinel/consumer-api/pull/42",
  ...overrides,
});

async function setup({ edit, pulls = [pull()], stepUp = true }: { edit?: (seed: StoreSeed) => void; pulls?: PullRequestInfo[]; stepUp?: boolean } = {}) {
  const { stores } = await seededStores((seed) => {
    seed.installations.push({ installationId: seed.repositories[0]!.githubInstallationId, organizationId: EXAMPLE_ORGANIZATION_ID, githubInstallationId: 77, accountLogin: "code-sentinel" });
    seed.reviews.push({
      reviewId: REVIEW_ID,
      organizationId: EXAMPLE_ORGANIZATION_ID,
      repositoryId: EXAMPLE_REPOSITORY_ID,
      trigger: "github_pull_request",
      prNumber: 42,
      headSha: HEAD,
      status: "completed",
      confidenceThreshold: 0.8,
      createdAt: new Date(),
    });
    seed.suggestions.push(suggestion());
    edit?.(seed);
  });
  const github = new StubGitHubClient();
  github.pullRequests.push(...pulls);
  github.repoFiles.set("app/payments.py", { sha: "blob-1", text: FILE });
  const supabase = await testSupabase();
  const app = createApp(testAppDeps({ stores, github, supabaseVerifier: supabase.verifier }));

  async function call(path: string, body?: unknown) {
    const token = await supabase.sign(TEST_USER_ID, stepUp ? stepUpClaims() : {});
    let result!: { status: number; body: Record<string, unknown> };
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      result = { status: response.status, body: (await response.json()) as Record<string, unknown> };
    });
    return result;
  }
  return { call, github, stores };
}

const ACCEPT = `/v1/findings/${FINDING_ID}/suggestion/accept`;
const REJECT = `/v1/findings/${FINDING_ID}/suggestion/reject`;

describe("POST /v1/findings/{id}/suggestion/accept", () => {
  it("commits the fix onto the pull request branch, replies on its comment and records the decision", async () => {
    const { call, github, stores } = await setup();

    const { status, body } = await call(ACCEPT);

    expect(status).toBe(200);
    const decision = SuggestionDecisionSchema.parse(body);
    expect(decision).toMatchObject({ findingId: FINDING_ID, state: "accepted", commitSha: github.commits[0]!.commitSha });
    expect(github.commits[0]).toMatchObject({ path: "app/payments.py", branch: "fix/retry", blobSha: "blob-1" });
    expect(github.commits[0]!.text).toBe("import os\ncur.execute(\"SELECT ?\", (c,))\n");
    expect(github.replies).toEqual([
      { ref: { installationId: 77, owner: "code-sentinel", repo: "consumer-api", pullNumber: 42 }, commentId: 5550, body: `Applied in ${decision.commitSha} from the Code Sentinel dashboard.` },
    ]);
    await expect(stores.suggestions.findByFinding(EXAMPLE_ORGANIZATION_ID, FINDING_ID)).resolves.toMatchObject({ state: "accepted", resolutionCommitSha: decision.commitSha });
  });

  it("asks for a fresh authenticator code first", async () => {
    const noCode = await setup({ stepUp: false });
    const refused = await noCode.call(ACCEPT);
    expect([refused.status, refused.body.code]).toEqual([403, "mfa_required"]);
    expect(noCode.github.commits).toEqual([]);
  });

  it("answers 404 for an unknown finding and one in another organization", async () => {
    const { call } = await setup({ edit: (seed) => (seed.reviews[0]!.organizationId = randomUUID()) });

    expect((await call(ACCEPT)).body.code).toBe("finding_not_found");
    expect((await call(`/v1/findings/${randomUUID()}/suggestion/accept`)).body.code).toBe("finding_not_found");
    expect((await call("/v1/findings/not-a-uuid/suggestion/accept")).status).toBe(404);
  });

  it("answers 409 when the fix is already decided, the head moved, it's a fork, or the lines changed", async () => {
    const decided = await setup({ edit: (seed) => (seed.suggestions[0]!.state = "superseded") });
    expect((await decided.call(ACCEPT)).body.code).toBe("suggestion_decided");

    const moved = await setup({ pulls: [pull({ headSha: "d".repeat(40) })] });
    expect((await moved.call(ACCEPT)).body.code).toBe("head_moved");

    const fork = await setup({ pulls: [pull({ headRepoFullName: "someone/consumer-api" })] });
    expect((await fork.call(ACCEPT)).body.code).toBe("fork_not_supported");

    const changed = await setup();
    changed.github.repoFiles.set("app/payments.py", { sha: "blob-2", text: "changed\n" });
    const response = await changed.call(ACCEPT);
    expect([response.status, response.body.code]).toEqual([409, "file_changed"]);
    expect(changed.github.commits).toEqual([]);
  });

  it("explains a missing Contents permission, and answers 502 when GitHub is down", async () => {
    const permission = await setup();
    vi.spyOn(permission.github, "updateFile").mockRejectedValue(Object.assign(new Error("Resource not accessible by integration"), { status: 403 }));
    expect((await permission.call(ACCEPT)).body.code).toBe("github_permission_missing");

    const down = await setup();
    vi.spyOn(down.github, "getPullRequest").mockRejectedValue(Object.assign(new Error("down"), { status: 500 }));
    const response = await down.call(ACCEPT);
    expect([response.status, response.body.code]).toEqual([502, "github_unavailable"]);
  });

  it("still records the decision when replying on GitHub fails", async () => {
    const { call, github } = await setup();
    vi.spyOn(github, "replyToReviewComment").mockRejectedValue(new Error("down"));

    expect((await call(ACCEPT)).status).toBe(200);
  });
});

describe("POST /v1/findings/{id}/suggestion/reject", () => {
  it("records the dismissal with its reason, without a step-up, and only once", async () => {
    const { call, stores, github } = await setup({ stepUp: false });

    const first = await call(REJECT, { reason: "false_positive", comment: "Test fixture" });
    const second = await call(REJECT, {});

    expect(first.status).toBe(200);
    expect(SuggestionDecisionSchema.parse(first.body)).toMatchObject({ findingId: FINDING_ID, state: "rejected" });
    expect([second.status, second.body.code]).toEqual([409, "suggestion_decided"]);
    await expect(stores.suggestions.findByFinding(EXAMPLE_ORGANIZATION_ID, FINDING_ID)).resolves.toMatchObject({ state: "rejected", rejectionReason: "false_positive" });
    expect(github.commits).toEqual([]);
  });

  it("answers 400 for an unknown reason", async () => {
    const { call } = await setup();

    expect((await call(REJECT, { reason: "meh" })).status).toBe(400);
  });
});
