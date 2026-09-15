import { ApiErrorSchema, ReviewJobRequestSchema, WebhookAcceptedSchema } from "@code-sentinel/contracts";
import { EXAMPLE_REVIEW_ID } from "@code-sentinel/contracts/examples";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import type { PullRequestFile } from "../github/github-client.js";
import { StubGitHubClient } from "../github/stub-github-client.js";
import { OrchestratorCallError } from "../orchestrator/orchestrator-call-error.js";
import type { OrchestratorClientLike } from "../orchestrator/orchestrator-client.js";
import { devSeed } from "../persistence/dev-seed.js";
import type { StoreSeed } from "../persistence/in-memory.js";
import {
  captureLogger,
  pullRequestEventPayload,
  reviewJobResponse,
  seededStores,
  signedWebhookHeaders,
  testAppDeps,
  TEST_DELIVERY_ID,
} from "../test-support/fixtures.js";
import { withServer } from "../test-support/with-server.js";

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
    createReviewJob: vi.fn<OrchestratorClientLike["createReviewJob"]>(
      createReviewJob ?? (async () => ({ job: reviewJobResponse(202), created: true })),
    ),
  };
  const app = createApp(testAppDeps({ logger, stores, github, orchestrator }));
  return { app, lines, github, orchestrator, findByGithubRepoId };
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

  it("answers repository_disabled when every agent is disabled", async () => {
    const target = await webhookApp({
      edit: (seed) => {
        for (const agent of ["security", "style", "performance", "logic", "documentation"] as const) {
          seed.repositoryAgentConfig.push({ repositoryId: seed.repositories[0]!.repositoryId, agent, enabled: false });
        }
      },
    });

    await expectIgnored(target, await deliver(target, pullRequestEventPayload()), "repository_disabled");
  });

  it("does not call the orchestrator when every file is filtered out", async () => {
    const target = await webhookApp({ files: devSeed().pullRequestFiles.slice(1) });

    await expectIgnored(target, await deliver(target, pullRequestEventPayload()), "event_ignored");
    expect(requestLog(target)).toMatchObject({
      outcome: "no_reviewable_files",
      files: 0,
      skippedFiles: { generated_file: 1, binary: 1 },
    });
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
});
