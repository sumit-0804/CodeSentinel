import { randomUUID } from "node:crypto";

import { PullRequestListResponseSchema, ReviewAcceptedSchema, ReviewJobRequestSchema } from "@code-sentinel/contracts";
import { EXAMPLE_ORGANIZATION_ID, EXAMPLE_REPOSITORY_ID } from "@code-sentinel/contracts/examples";
import { withServer } from "@code-sentinel/service-kit/testing";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import type { PullRequestFile, PullRequestInfo } from "../github/github-client.js";
import { StubGitHubClient } from "../github/stub-github-client.js";
import { OrchestratorCallError } from "../orchestrator/orchestrator-call-error.js";
import type { OrchestratorClientLike } from "../orchestrator/orchestrator-client.js";
import { devSeed } from "../persistence/dev-seed.js";
import type { StoreSeed } from "../persistence/in-memory.js";
import { fakeOrchestrator, reviewJobResponse, seededStores, testAppDeps, TEST_USER_ID } from "../test-support/fixtures.js";
import { testSupabase } from "../test-support/supabase-tokens.js";

const NOW = new Date("2026-10-14T12:00:00Z");
const INSTALLATION = 4242;

const pull = (number: number, overrides: Partial<PullRequestInfo> = {}): PullRequestInfo => ({
  number,
  title: `PR ${number}`,
  author: "octocat",
  state: "open",
  draft: false,
  headSha: `${number}`.padStart(40, "a"),
  headRef: `feature/${number}`,
  baseSha: "b".repeat(40),
  baseRef: "main",
  updatedAt: `2026-10-14T1${number % 10}:00:00Z`,
  htmlUrl: `https://github.com/code-sentinel/consumer-api/pull/${number}`,
  ...overrides,
});

interface Options {
  edit?: (seed: StoreSeed) => void;
  pulls?: PullRequestInfo[];
  files?: PullRequestFile[];
  orchestrator?: Partial<OrchestratorClientLike>;
  github?: (github: StubGitHubClient) => void;
}

async function setup({ edit, pulls = [pull(42)], files = devSeed().pullRequestFiles, orchestrator = {}, github: editGithub }: Options = {}) {
  const { stores, apiKey } = await seededStores((seed) => {
    seed.installations.push({ installationId: seed.repositories[0]!.githubInstallationId, organizationId: EXAMPLE_ORGANIZATION_ID, githubInstallationId: INSTALLATION, accountLogin: "code-sentinel" });
    edit?.(seed);
  });
  const github = new StubGitHubClient(files);
  github.pullRequests.push(...pulls);
  editGithub?.(github);
  const supabase = await testSupabase(() => NOW);
  const createReviewJob = vi.fn<OrchestratorClientLike["createReviewJob"]>(async () => ({ job: reviewJobResponse(202), created: true }));
  const cancelReviewJob = vi.fn<OrchestratorClientLike["cancelReviewJob"]>(async () => undefined);
  const publisher = { follow: vi.fn(async () => {}), nothingToReview: vi.fn(async () => {}) };
  let clock = NOW.getTime();
  const app = createApp(
    testAppDeps({
      stores,
      github,
      orchestrator: fakeOrchestrator({ createReviewJob, cancelReviewJob, ...orchestrator }),
      publisher,
      supabaseVerifier: supabase.verifier,
      now: () => new Date(clock),
    }),
  );

  async function call(method: string, path: string, { body, as }: { body?: unknown; as?: "apiKey" } = {}) {
    const token = as === "apiKey" ? apiKey : await supabase.sign(TEST_USER_ID);
    let result!: { status: number; body: Record<string, unknown> };
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      result = { status: response.status, body: (await response.json()) as Record<string, unknown> };
    });
    return result;
  }
  const advance = (ms: number) => (clock += ms);
  return { call, github, createReviewJob, cancelReviewJob, publisher, stores, advance };
}

const rerun = (pullRequestNumber = 42, repositoryId = EXAMPLE_REPOSITORY_ID) => ({ repositoryId, pullRequestNumber });

describe("POST /v1/reviews (re-run a pull request)", () => {
  it("reviews the open pull request's head as dashboard_manual and publishes it", async () => {
    const { call, createReviewJob, publisher } = await setup();

    const { status, body } = await call("POST", "/v1/reviews", { body: rerun() });

    expect(status).toBe(202);
    expect(ReviewAcceptedSchema.parse(body)).toEqual({ reviewId: reviewJobResponse(202).reviewId, status: "queued" });
    const [request, options] = createReviewJob.mock.calls[0]!;
    expect(ReviewJobRequestSchema.parse(request)).toMatchObject({
      trigger: "dashboard_manual",
      triggeredByUserId: TEST_USER_ID,
      headSha: pull(42).headSha,
      pullRequest: { number: 42, headRef: "feature/42", baseRef: "main" },
    });
    expect(options?.idempotencyKey).toMatch(/^rerun-/);
    expect(publisher.follow).toHaveBeenCalledWith(
      expect.objectContaining({ ref: { installationId: INSTALLATION, owner: "code-sentinel", repo: "consumer-api", pullNumber: 42 }, headSha: pull(42).headSha }),
    );
  });

  it("cancels the pull request's older review that is still running", async () => {
    const older = { reviewId: randomUUID(), jobId: randomUUID() };
    const { call, cancelReviewJob } = await setup({
      edit: (seed) =>
        seed.reviews.push({
          ...older,
          organizationId: EXAMPLE_ORGANIZATION_ID,
          repositoryId: EXAMPLE_REPOSITORY_ID,
          trigger: "github_pull_request",
          prNumber: 42,
          headSha: pull(42).headSha,
          status: "running",
          confidenceThreshold: 0.8,
          createdAt: new Date(NOW.getTime() - 5 * 60_000),
        }),
    });

    expect((await call("POST", "/v1/reviews", { body: rerun() })).status).toBe(202);
    await vi.waitFor(() => expect(cancelReviewJob).toHaveBeenCalledWith(older.jobId, { requestId: expect.any(String) }));
  });

  it("refuses a second run within 30 s with 409 review_in_progress", async () => {
    const { call, createReviewJob, advance } = await setup({
      edit: (seed) =>
        seed.reviews.push({
          reviewId: randomUUID(),
          jobId: randomUUID(),
          organizationId: EXAMPLE_ORGANIZATION_ID,
          repositoryId: EXAMPLE_REPOSITORY_ID,
          trigger: "dashboard_manual",
          prNumber: 42,
          headSha: pull(42).headSha,
          status: "queued",
          confidenceThreshold: 0.8,
          createdAt: new Date(NOW.getTime() - 10_000),
        }),
    });

    const first = await call("POST", "/v1/reviews", { body: rerun() });
    expect([first.status, first.body.code]).toEqual([409, "review_in_progress"]);
    advance(25_000);
    expect((await call("POST", "/v1/reviews", { body: rerun() })).status).toBe(202);
    expect(createReviewJob).toHaveBeenCalledTimes(1);
  });

  it("answers 404 for another organization's repository, an unknown one, and a closed or missing pull request", async () => {
    const { call, createReviewJob } = await setup({ pulls: [pull(42), pull(7, { state: "closed" })] });

    for (const [body, code] of [
      [rerun(42, randomUUID()), "repository_not_found"],
      [rerun(7), "pull_request_not_found"],
      [rerun(99), "pull_request_not_found"],
    ] as const) {
      const response = await call("POST", "/v1/reviews", { body });
      expect([response.status, response.body.code]).toEqual([404, code]);
    }
    expect(createReviewJob).not.toHaveBeenCalled();
  });

  it("answers 409 for a base branch that isn't reviewed, and for a repository with reviews off", async () => {
    const branch = await setup({ pulls: [pull(42, { baseRef: "experiments" })] });
    const ignored = await branch.call("POST", "/v1/reviews", { body: rerun() });
    expect([ignored.status, ignored.body.code]).toEqual([409, "branch_ignored"]);

    const off = await setup({ edit: (seed) => (seed.repositories[0]!.reviewEnabled = false) });
    const disabled = await off.call("POST", "/v1/reviews", { body: rerun() });
    expect([disabled.status, disabled.body.code]).toEqual([409, "repository_disabled"]);
  });

  it("answers 422 no_reviewable_files and posts the Nothing to review Check Run", async () => {
    const { call, publisher, createReviewJob } = await setup({ files: devSeed().pullRequestFiles.slice(1) });

    const { status, body } = await call("POST", "/v1/reviews", { body: rerun() });

    expect([status, body.code]).toEqual([422, "no_reviewable_files"]);
    expect(publisher.nothingToReview).toHaveBeenCalledTimes(1);
    expect(createReviewJob).not.toHaveBeenCalled();
  });

  it("refuses API keys, answers 501 for the file-set body and 400 for anything else", async () => {
    const { call } = await setup();

    expect((await call("POST", "/v1/reviews", { body: rerun(), as: "apiKey" })).body.code).toBe("session_required");
    const files = await call("POST", "/v1/reviews", {
      body: { repositoryId: EXAMPLE_REPOSITORY_ID, files: [{ path: "a.py", language: "python", changeType: "modified", patch: "@@ -1 +1 @@\n-a\n+b" }] },
    });
    expect([files.status, files.body.code]).toEqual([501, "not_implemented"]);
    expect((await call("POST", "/v1/reviews", { body: { pullRequestNumber: "x" } })).status).toBe(400);
  });

  it("answers 502 when GitHub or the orchestrator fails", async () => {
    const githubDown = await setup({ github: (g) => vi.spyOn(g, "getPullRequest").mockRejectedValue(Object.assign(new Error("down"), { status: 500 })) });
    expect((await githubDown.call("POST", "/v1/reviews", { body: rerun() })).body.code).toBe("github_unavailable");

    const orchestratorDown = await setup({
      orchestrator: {
        createReviewJob: async () => {
          throw new OrchestratorCallError("down", { kind: "network", latencyMs: 1 });
        },
      },
    });
    const response = await orchestratorDown.call("POST", "/v1/reviews", { body: rerun() });
    expect([response.status, response.body.code]).toEqual([502, "orchestrator_unavailable"]);
  });
});

describe("GET /v1/repositories/{id}/pulls", () => {
  it("lists open pull requests, newest first, with their latest review and whether they're reviewed", async () => {
    const reviewId = randomUUID();
    const { call } = await setup({
      pulls: [pull(41, { updatedAt: "2026-10-14T09:00:00Z" }), pull(42, { updatedAt: "2026-10-14T11:00:00Z", baseRef: "experiments" }), pull(43, { state: "closed" })],
      edit: (seed) =>
        seed.reviews.push({
          reviewId,
          organizationId: EXAMPLE_ORGANIZATION_ID,
          repositoryId: EXAMPLE_REPOSITORY_ID,
          trigger: "github_pull_request",
          prNumber: 41,
          headSha: pull(41).headSha,
          status: "completed",
          checkConclusion: "fail",
          confidenceThreshold: 0.8,
          createdAt: new Date(NOW.getTime() - 60_000),
        }),
    });

    const { status, body } = await call("GET", `/v1/repositories/${EXAMPLE_REPOSITORY_ID}/pulls`, { as: "apiKey" });

    expect(status).toBe(200);
    const { items } = PullRequestListResponseSchema.parse(body);
    expect(items.map((item) => [item.number, item.reviewable, item.latestReview?.reviewId ?? null])).toEqual([
      [42, false, null],
      [41, true, reviewId],
    ]);
    expect(items[1]).toMatchObject({ author: "octocat", headRef: "feature/41", latestReview: { checkConclusion: "fail" } });
  });

  it("reuses GitHub's answer for 30 s", async () => {
    const { call, github, advance } = await setup();

    await call("GET", `/v1/repositories/${EXAMPLE_REPOSITORY_ID}/pulls`);
    await call("GET", `/v1/repositories/${EXAMPLE_REPOSITORY_ID}/pulls`);
    expect(github.pullRequestListCalls).toBe(1);
    advance(31_000);
    await call("GET", `/v1/repositories/${EXAMPLE_REPOSITORY_ID}/pulls`);
    expect(github.pullRequestListCalls).toBe(2);
  });

  it("answers 404 for another organization's repository and 502 when GitHub fails", async () => {
    const { call } = await setup({ github: (g) => vi.spyOn(g, "listOpenPullRequests").mockRejectedValue(new Error("down")) });

    expect((await call("GET", `/v1/repositories/${randomUUID()}/pulls`)).status).toBe(404);
    const failed = await call("GET", `/v1/repositories/${EXAMPLE_REPOSITORY_ID}/pulls`);
    expect([failed.status, failed.body.code]).toEqual([502, "github_unavailable"]);
  });
});
