import { ApiErrorSchema, ReviewJobRequestSchema, WebhookAcceptedSchema } from "@code-sentinel/contracts";
import { EXAMPLE_REVIEW_ID } from "@code-sentinel/contracts/examples";
import { captureLogger, withServer } from "@code-sentinel/service-kit/testing";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import type { PullRequestFile } from "../github/github-client.js";
import { StubGitHubClient } from "../github/stub-github-client.js";
import { OrchestratorCallError } from "../orchestrator/orchestrator-call-error.js";
import type { OrchestratorClientLike } from "../orchestrator/orchestrator-client.js";
import { devSeed } from "../persistence/dev-seed.js";
import type { StoreSeed } from "../persistence/in-memory.js";
import {
  pullRequestEventPayload,
  reviewJobResponse,
  seededStores,
  signedWebhookHeaders,
  testAppDeps,
  TEST_DELIVERY_ID,
} from "../test-support/fixtures.js";

interface WebhookAppOptions {
  edit?: (seed: StoreSeed) => void;
  files?: PullRequestFile[];
  createReviewJob?: OrchestratorClientLike["createReviewJob"];
}

async function webhookApp({ edit, files = devSeed().pullRequestFiles, createReviewJob }: WebhookAppOptions = {}) {
  const { logger, lines } = captureLogger();
  const { stores } = await seededStores(edit);
  const findByGithubRepoId = vi.spyOn(stores.repositories, "findByGithubRepoId");
  const github = new StubGitHubClient(files);
  const orchestrator = {
    health: async () => ({ status: "ok" as const }),
    agentsHealth: async () => ({ checkedAt: "2026-10-19T10:00:00.000Z", agents: [] }),
    createReviewJob: vi.fn<OrchestratorClientLike["createReviewJob"]>(
      createReviewJob ?? (async () => ({ job: reviewJobResponse(202), created: true })),
    ),
    cancelReviewJob: vi.fn<OrchestratorClientLike["cancelReviewJob"]>(async () => ({ ...reviewJobResponse(202), status: "cancelled" })),
  };
  const publisher = { follow: vi.fn(async () => {}), nothingToReview: vi.fn(async () => {}) };
  const app = createApp(testAppDeps({ logger, stores, github, orchestrator, publisher }));
  return { app, lines, stores, github, orchestrator, findByGithubRepoId, publisher };
}

type WebhookApp = Awaited<ReturnType<typeof webhookApp>>;

async function deliver(
  { app }: WebhookApp,
  payload: unknown,
  { event, headers = {}, rawBody }: { event?: string; headers?: Record<string, string>; rawBody?: string } = {},
) {
  const body = rawBody ?? JSON.stringify(payload);
  let result!: { status: number; body: Record<string, unknown> };
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/webhooks/github`, {
      method: "POST",
      body,
      headers: { ...signedWebhookHeaders(body, undefined, event ? { event } : {}), ...headers },
    });
    result = { status: response.status, body: (await response.json()) as Record<string, unknown> };
  });
  return result;
}

const requestLog = ({ lines }: WebhookApp) => lines.find((line) => line.message === "request");

/** Asserts a 202 with `action` and that no review was started. */
async function expectIgnored(target: WebhookApp, response: { status: number; body: Record<string, unknown> }, action: string) {
  expect(response.status).toBe(202);
  expect(WebhookAcceptedSchema.parse(response.body)).toEqual({ accepted: true, action });
  expect(target.orchestrator.createReviewJob).not.toHaveBeenCalled();
}

describe("POST /webhooks/github: verification", () => {
  it("returns 401 invalid_signature for a bad signature", async () => {
    const target = await webhookApp();
    const body = JSON.stringify(pullRequestEventPayload());

    const response = await deliver(target, undefined, {
      rawBody: body,
      headers: { "X-Hub-Signature-256": signedWebhookHeaders(body, "wrong-secret-0123")["X-Hub-Signature-256"]! },
    });

    expect(response.status).toBe(401);
    expect(ApiErrorSchema.parse(response.body).code).toBe("invalid_signature");
    expect(target.github.calls).toEqual([]);
    expect(target.orchestrator.createReviewJob).not.toHaveBeenCalled();
  });

  it("never parses or forwards an unsigned payload (FR-GW-03)", async () => {
    const target = await webhookApp();
    let result!: { status: number; body: Record<string, unknown> };
    await withServer(target.app, async (baseUrl) => {
      const { "X-Hub-Signature-256": _signature, ...unsigned } = signedWebhookHeaders("{not json");
      const response = await fetch(`${baseUrl}/webhooks/github`, { method: "POST", body: "{not json", headers: unsigned });
      result = { status: response.status, body: (await response.json()) as Record<string, unknown> };
    });

    expect(result.status).toBe(401);
    expect(result.body.code).toBe("invalid_signature");
    expect(target.findByGithubRepoId).not.toHaveBeenCalled();
    expect(target.github.calls).toEqual([]);
    expect(target.orchestrator.createReviewJob).not.toHaveBeenCalled();
    expect(requestLog(target)).toMatchObject({ status: 401, outcome: "invalid_signature" });
    expect(JSON.stringify(requestLog(target))).not.toContain("not json");
  });

  it("returns 400 missing_header without X-GitHub-Delivery", async () => {
    const target = await webhookApp();
    const body = JSON.stringify(pullRequestEventPayload());
    const { "X-GitHub-Delivery": _delivery, ...headers } = signedWebhookHeaders(body);
    let status = 0;
    let code: unknown;
    await withServer(target.app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/webhooks/github`, { method: "POST", body, headers });
      status = response.status;
      code = ((await response.json()) as Record<string, unknown>).code;
    });

    expect(status).toBe(400);
    expect(code).toBe("missing_header");
  });

  it("returns 400 invalid_payload for a signed body that is not JSON", async () => {
    const response = await deliver(await webhookApp(), undefined, { rawBody: "{not json" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("invalid_payload");
  });

  it("returns 400 invalid_payload for a pull_request event without repository", async () => {
    const { repository: _repository, ...payload } = pullRequestEventPayload();

    const response = await deliver(await webhookApp(), payload);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("invalid_payload");
  });
});

describe("POST /webhooks/github: review flow", () => {
  it("starts a review for pull_request.opened", async () => {
    const target = await webhookApp();

    const response = await deliver(target, pullRequestEventPayload(), { headers: { "X-Request-Id": "req-webhook-1" } });

    expect(response.status).toBe(202);
    expect(WebhookAcceptedSchema.parse(response.body)).toEqual({
      accepted: true,
      reviewId: EXAMPLE_REVIEW_ID,
      action: "review_started",
    });
    expect(target.github.calls).toEqual([{ installationId: 42, owner: "code-sentinel", repo: "consumer-api", pullNumber: 42 }]);
    const [request, options] = target.orchestrator.createReviewJob.mock.calls[0]!;
    expect(options).toEqual({ idempotencyKey: TEST_DELIVERY_ID, requestId: "req-webhook-1" });
    const job = ReviewJobRequestSchema.parse(request);
    expect(job.files.map((file) => file.path)).toEqual(["payments/retry_queue.py"]);
    expect(job.skippedFiles).toEqual([
      { path: "package-lock.json", reason: "generated_file" },
      { path: "logo.png", reason: "binary" },
    ]);
    expect(requestLog(target)).toMatchObject({ status: 202, outcome: "review_started", deliveryId: TEST_DELIVERY_ID });
  });

  it("sends each changed file whole, read at the pull request's head", async () => {
    const target = await webhookApp();
    target.github.repoFiles.set("payments/retry_queue.py", { sha: "blob-1", text: "import time\n\ndef retry():\n    pass\n" });

    await deliver(target, pullRequestEventPayload());

    const job = ReviewJobRequestSchema.parse(target.orchestrator.createReviewJob.mock.calls[0]![0]);
    expect(job.files[0]!.content).toBe("import time\n\ndef retry():\n    pass\n");
  });

  it.each(["synchronize", "reopened"])("starts a review for pull_request.%s", async (action) => {
    const target = await webhookApp();

    const response = await deliver(target, pullRequestEventPayload({ action }));

    expect(response.status).toBe(202);
    expect(response.body.action).toBe("review_started");
    expect(target.orchestrator.createReviewJob).toHaveBeenCalledOnce();
  });

  it("answers duplicate_ignored when the orchestrator returns an existing job", async () => {
    const target = await webhookApp({ createReviewJob: async () => ({ job: reviewJobResponse(200), created: false }) });

    const response = await deliver(target, pullRequestEventPayload());

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ accepted: true, reviewId: EXAMPLE_REVIEW_ID, action: "duplicate_ignored" });
  });

  it("ignores pull_request.closed without calling GitHub", async () => {
    const target = await webhookApp();

    await expectIgnored(target, await deliver(target, pullRequestEventPayload({ action: "closed" })), "event_ignored");
    expect(target.github.calls).toEqual([]);
  });

  it("acknowledges a ping event", async () => {
    const target = await webhookApp();

    await expectIgnored(target, await deliver(target, { zen: "Keep it logically awesome.", hook_id: 1 }, { event: "ping" }), "event_ignored");
  });

  describe("Apply all fixes on the Check Run", () => {
    const head = "a".repeat(40);
    const reviewId = "7a1c3a92-4c1e-4c22-9a0e-6f2f4b9d0a99";
    const MEMBER_GITHUB_ID = 583231;
    const fix = { kind: "ai_suggested" as const, originalSnippet: "x = 1", suggestedSnippet: "x = 2" };

    /** A finished review of PR 42 with Check Run 901 and one open AI fix; the seed user is linked to GitHub. */
    function seedReview(seed: StoreSeed) {
      seed.users[0]!.githubUserId = MEMBER_GITHUB_ID;
      seed.reviews.push({
        reviewId,
        organizationId: seed.repositories[0]!.organizationId,
        repositoryId: seed.repositories[0]!.repositoryId,
        trigger: "github_pull_request",
        prNumber: 42,
        headSha: head,
        status: "completed",
        confidenceThreshold: 0.8,
        createdAt: new Date(),
        githubCheckRunId: 901,
        report: {
          reviewId,
          status: "completed",
          summary: { criticalCount: 0, warningCount: 1, infoCount: 0, autoFixedCount: 0, suggestedFixCount: 1 },
          agentRuns: [],
          findings: [{ agent: "logic", ruleId: "logic/x", title: "Wrong value", description: "d", location: { filePath: "a.py", lineStart: 1, lineEnd: 1 }, severity: "warning", confidence: 0.9, suggestion: fix }],
        },
      });
      seed.suggestions.push({
        suggestionId: "8b1c3a92-4c1e-4c22-9a0e-6f2f4b9d0a98",
        findingId: "9c1c3a92-4c1e-4c22-9a0e-6f2f4b9d0a97",
        reviewId,
        agent: "logic",
        ruleId: "logic/x",
        title: "Wrong value",
        filePath: "a.py",
        lineStart: 1,
        lineEnd: 1,
        state: "proposed",
        ...fix,
      });
    }

    async function appWithOpenPull() {
      const target = await webhookApp({ edit: seedReview });
      target.github.pullRequests.push({ number: 42, title: "PR", state: "open", draft: false, headSha: head, headRef: "feature/x", baseSha: "b".repeat(40), baseRef: "main", updatedAt: "2026-10-16T10:00:00Z", htmlUrl: "https://github.com/x/y/pull/42" });
      target.github.repoFiles.set("a.py", { sha: "blob", text: "x = 1\n" });
      return target;
    }

    const click = (identifier: string, { checkRunId = 901, senderId = MEMBER_GITHUB_ID } = {}) => ({
      action: "requested_action",
      check_run: { id: checkRunId },
      requested_action: { identifier },
      repository: { id: (pullRequestEventPayload().repository as { id: number }).id },
      sender: { id: senderId, login: "octocat" },
    });

    it("commits every open fix in the background when a member clicks it, recorded as theirs", async () => {
      const target = await appWithOpenPull();

      const response = await deliver(target, click("apply_all"), { event: "check_run" });

      expect(response.status).toBe(202);
      expect(WebhookAcceptedSchema.parse(response.body)).toEqual({ accepted: true, action: "fixes_applying", reviewId });
      await vi.waitFor(() => expect(target.github.pullRequestComments).toHaveLength(1));
      expect(target.github.multiCommits[0]).toMatchObject({ branch: "feature/x", parentSha: head, files: [{ path: "a.py", text: "x = 2\n" }] });
      expect(target.github.pullRequestComments[0]!.body).toContain("as @octocat (Check Run) asked");
      await expect(target.stores.suggestions.forReview(reviewId)).resolves.toMatchObject([
        { state: "accepted", resolutionCommitSha: target.github.multiCommits[0]!.commitSha },
      ]);
      const organizationId = (await target.stores.reviews.findByCheckRun(901))!.organizationId;
      await vi.waitFor(async () =>
        expect(await target.stores.audit.listForOrganization(organizationId, { limit: 5 })).toMatchObject([
          { action: "fixes_applied", targetId: reviewId, metadata: { via: "check_run", githubLogin: "octocat", applied: 1 } },
        ]),
      );

      await expectIgnored(target, await deliver(target, click("something_else"), { event: "check_run" }), "event_ignored");
      await expectIgnored(target, await deliver(target, click("apply_all", { checkRunId: 999 }), { event: "check_run" }), "event_ignored");
    });

    it("leaves AI fixes alone when the clicker has no Code Sentinel account, and says so", async () => {
      const target = await appWithOpenPull();

      const response = await deliver(target, click("apply_all", { senderId: 999_999 }), { event: "check_run" });

      expect(response.status).toBe(202);
      await vi.waitFor(() => expect(target.github.pullRequestComments).toHaveLength(1));
      expect(target.github.multiCommits).toHaveLength(0);
      expect(target.github.pullRequestComments[0]!.body).toContain("**1 AI-suggested fix was not applied.**");
      await expect(target.stores.suggestions.forReview(reviewId)).resolves.toMatchObject([{ state: "proposed" }]);
    });
  });

  it("acknowledges an installation event", async () => {
    const target = await webhookApp();

    await expectIgnored(target, await deliver(target, { action: "created", installation: { id: 42 } }, { event: "installation" }), "event_ignored");
  });

  it("ignores a repository the gateway does not know, without calling GitHub", async () => {
    const target = await webhookApp();
    const payload = pullRequestEventPayload();
    (payload.repository as Record<string, unknown>).id = 987654321;

    await expectIgnored(target, await deliver(target, payload), "event_ignored");
    expect(target.github.calls).toEqual([]);
    expect(requestLog(target)).toMatchObject({ outcome: "repository_unknown" });
  });

  it("answers repository_disabled when reviews are off for the repository", async () => {
    const target = await webhookApp({
      edit: (seed) => {
        seed.repositories[0]!.reviewEnabled = false;
      },
    });

    await expectIgnored(target, await deliver(target, pullRequestEventPayload()), "repository_disabled");
  });

  it("answers repository_disabled when every agent is off", async () => {
    const target = await webhookApp({
      edit: (seed) => {
        seed.repositories[0]!.useOrgDefaults = false;
        for (const agent of ["security", "style", "performance", "logic", "documentation"] as const) {
          seed.repositoryAgentConfig.push({ repositoryId: seed.repositories[0]!.repositoryId, agent, mode: "off" });
        }
      },
    });

    await expectIgnored(target, await deliver(target, pullRequestEventPayload()), "repository_disabled");
  });

  it("answers branch_ignored for a pull request into a branch the repository doesn't review", async () => {
    const target = await webhookApp({
      edit: (seed) => {
        seed.repositories[0]!.useOrgDefaults = false;
        seed.repositorySettings.push({ repositoryId: seed.repositories[0]!.repositoryId, reviewBranches: ["release/*"] });
      },
    });

    await expectIgnored(target, await deliver(target, pullRequestEventPayload()), "branch_ignored");
    expect(requestLog(target)).toMatchObject({ outcome: "branch_ignored", baseRef: "main" });
  });

  it("reviews by the repository's own branches even while it follows the organization defaults", async () => {
    const target = await webhookApp({
      edit: (seed) => {
        seed.repositorySettings.push({ repositoryId: seed.repositories[0]!.repositoryId, reviewBranches: ["develop", "main"] });
      },
    });

    const res = await deliver(target, pullRequestEventPayload());

    expect(res.body).toMatchObject({ accepted: true, action: "review_started" });
  });

  it("does not call the orchestrator when every file is filtered out, but posts a Nothing to review Check Run", async () => {
    const target = await webhookApp({ files: devSeed().pullRequestFiles.slice(1) });

    await expectIgnored(target, await deliver(target, pullRequestEventPayload()), "event_ignored");
    expect(requestLog(target)).toMatchObject({
      outcome: "no_reviewable_files",
      files: 0,
      skippedFiles: { generated_file: 1, binary: 1 },
    });
    expect(target.publisher.nothingToReview).toHaveBeenCalledWith({
      ref: { installationId: 42, owner: "code-sentinel", repo: "consumer-api", pullNumber: 42 },
      headSha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      skippedFiles: [expect.objectContaining({ reason: "generated_file" }), expect.objectContaining({ reason: "binary" })],
      requestId: expect.any(String),
    });
    expect(target.publisher.follow).not.toHaveBeenCalled();
  });

  it("cancels the pull request's running review of an older commit once the new one starts", async () => {
    const older = { jobId: "11111111-1111-4111-8111-111111111111", reviewId: "22222222-2222-4222-8222-222222222222" };
    const target = await webhookApp({
      edit: (seed) => {
        const repo = seed.repositories[0]!;
        const base = { organizationId: repo.organizationId, repositoryId: repo.repositoryId, trigger: "github_pull_request" as const, confidenceThreshold: 0.8 };
        seed.reviews.push(
          { ...base, ...older, prNumber: 42, headSha: "0".repeat(40), status: "running", createdAt: new Date() },
          // Another pull request, and a finished review of this one: both left alone.
          { ...base, reviewId: "33333333-3333-4333-8333-333333333333", jobId: "44444444-4444-4444-8444-444444444444", prNumber: 7, headSha: "1".repeat(40), status: "running", createdAt: new Date() },
          { ...base, reviewId: "55555555-5555-4555-8555-555555555555", jobId: "66666666-6666-4666-8666-666666666666", prNumber: 42, headSha: "2".repeat(40), status: "completed", createdAt: new Date() },
        );
      },
    });

    const response = await deliver(target, pullRequestEventPayload({ action: "synchronize" }));
    await vi.waitFor(() => expect(target.orchestrator.cancelReviewJob).toHaveBeenCalledTimes(1));

    expect(response.body).toMatchObject({ action: "review_started" });
    expect(target.orchestrator.cancelReviewJob).toHaveBeenCalledWith(older.jobId, { requestId: expect.any(String) });
    expect(target.lines.find((line) => line.message === "superseded review cancelled")).toMatchObject({ reviewId: older.reviewId });
  });

  it("still starts the new review when cancelling the old one fails", async () => {
    const target = await webhookApp({
      edit: (seed) => {
        const repo = seed.repositories[0]!;
        seed.reviews.push({
          organizationId: repo.organizationId,
          repositoryId: repo.repositoryId,
          trigger: "github_pull_request",
          confidenceThreshold: 0.8,
          reviewId: "22222222-2222-4222-8222-222222222222",
          jobId: "11111111-1111-4111-8111-111111111111",
          prNumber: 42,
          headSha: "0".repeat(40),
          status: "queued",
          createdAt: new Date(),
        });
      },
    });
    target.orchestrator.cancelReviewJob.mockRejectedValueOnce(new OrchestratorCallError("down", { kind: "network", latencyMs: 1 }));

    const response = await deliver(target, pullRequestEventPayload({ action: "synchronize" }));
    await vi.waitFor(() => expect(target.lines.some((line) => line.message === "could not cancel a superseded review")).toBe(true));

    expect(response.body).toMatchObject({ action: "review_started" });
    expect(target.publisher.follow).toHaveBeenCalledTimes(1);
  });

  it("returns 502 orchestrator_unavailable when the orchestrator cannot be reached", async () => {
    const target = await webhookApp({
      createReviewJob: async () => {
        throw new OrchestratorCallError("unreachable", { kind: "network", latencyMs: 3 });
      },
    });

    const response = await deliver(target, pullRequestEventPayload());

    expect(response.status).toBe(502);
    expect(ApiErrorSchema.parse(response.body)).toMatchObject({ code: "orchestrator_unavailable", details: { kind: "network" } });
    expect(requestLog(target)).toMatchObject({ status: 502, outcome: "orchestrator_unavailable" });
  });

  it("hands a new job to the publisher after answering, and never a duplicate or an ignored event", async () => {
    const target = await webhookApp();
    await deliver(target, pullRequestEventPayload());

    expect(target.publisher.follow).toHaveBeenCalledTimes(1);
    expect(target.publisher.follow).toHaveBeenCalledWith({
      ref: { installationId: 42, owner: "code-sentinel", repo: "consumer-api", pullNumber: 42 },
      headSha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      jobId: reviewJobResponse(202).jobId,
      reviewId: EXAMPLE_REVIEW_ID,
      requestId: expect.any(String),
      threshold: 0.8,
      blockingAgents: ["security"],
      postInlineComments: true,
    });

    const duplicate = await webhookApp({ createReviewJob: async () => ({ job: reviewJobResponse(200), created: false }) });
    await deliver(duplicate, pullRequestEventPayload());
    await deliver(duplicate, pullRequestEventPayload({ action: "closed" }));
    expect(duplicate.publisher.follow).not.toHaveBeenCalled();
  });
});
