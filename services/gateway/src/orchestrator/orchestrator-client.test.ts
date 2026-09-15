import { exampleReviewJobRequest } from "@code-sentinel/contracts/examples";
import { describe, expect, it, vi } from "vitest";

import { reviewJobResponse } from "../test-support/fixtures.js";
import { OrchestratorCallError } from "./orchestrator-call-error.js";
import { OrchestratorClient, type FetchLike } from "./orchestrator-client.js";

const BASE_URL = "http://orchestrator.internal:8080/";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function client(fetchImpl: FetchLike, timeoutMs = 1000) {
  return new OrchestratorClient({ baseUrl: BASE_URL, serviceToken: "service-token", timeoutMs, fetch: fetchImpl });
}

/** Resolves only when the signal aborts, the way real fetch behaves against a silent server. */
const hangingFetch: FetchLike = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

async function callError(promise: Promise<unknown>): Promise<OrchestratorCallError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(OrchestratorCallError);
  return error as OrchestratorCallError;
}

const create = (fetchImpl: FetchLike) => client(fetchImpl).createReviewJob(exampleReviewJobRequest);

describe("OrchestratorClient.createReviewJob", () => {
  it("posts the job with bearer token, Idempotency-Key and X-Request-Id", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(reviewJobResponse(202), 202));

    await client(fetchImpl).createReviewJob(exampleReviewJobRequest, { idempotencyKey: "delivery-1", requestId: "req-1" });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://orchestrator.internal:8080/internal/v1/review-jobs");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual(exampleReviewJobRequest);
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer service-token",
      "Content-Type": "application/json",
      "Idempotency-Key": "delivery-1",
      "X-Request-Id": "req-1",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("omits Idempotency-Key and X-Request-Id when not given", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(reviewJobResponse(202), 202));

    await create(fetchImpl);

    const headers = fetchImpl.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers).not.toHaveProperty("Idempotency-Key");
    expect(headers).not.toHaveProperty("X-Request-Id");
  });

  it("returns created: true with the validated job on 202", async () => {
    await expect(create(async () => jsonResponse(reviewJobResponse(202), 202))).resolves.toEqual({
      job: reviewJobResponse(202),
      created: true,
    });
  });

  it("returns created: false for an existing job on 200", async () => {
    await expect(create(async () => jsonResponse(reviewJobResponse(200), 200))).resolves.toEqual({
      job: reviewJobResponse(200),
      created: false,
    });
  });

  it("maps a 422 to an http error with the status", async () => {
    const error = await callError(create(async () => jsonResponse({ code: "no_agents_enabled", message: "none" }, 422)));

    expect(error.kind).toBe("http");
    expect(error.status).toBe(422);
    expect(error.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("maps a 500 to an http error", async () => {
    const error = await callError(create(async () => jsonResponse({ code: "boom", message: "boom" }, 500)));

    expect(error.kind).toBe("http");
    expect(error.status).toBe(500);
  });

  it("maps malformed JSON on 202 to invalid_response", async () => {
    const error = await callError(create(async () => new Response("{not json", { status: 202 })));

    expect(error.kind).toBe("invalid_response");
  });

  it("maps a 202 body missing jobId to invalid_response", async () => {
    const { jobId: _jobId, ...withoutJobId } = reviewJobResponse(202);

    const error = await callError(create(async () => jsonResponse(withoutJobId, 202)));

    expect(error.kind).toBe("invalid_response");
  });

  it("times out a fetch that never resolves", async () => {
    const started = Date.now();

    const error = await callError(client(hangingFetch, 30).createReviewJob(exampleReviewJobRequest));

    expect(error.kind).toBe("timed_out");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("maps a fetch TypeError to network", async () => {
    const error = await callError(
      create(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    expect(error.kind).toBe("network");
    expect(error.cause).toBeInstanceOf(TypeError);
  });
});

describe("OrchestratorClient.health", () => {
  it("gets /healthz and validates it", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ status: "ok", version: "0.1.0" }));

    await expect(client(fetchImpl).health()).resolves.toEqual({ status: "ok", version: "0.1.0" });
    expect(fetchImpl.mock.calls[0]![0]).toBe("http://orchestrator.internal:8080/healthz");
    expect(fetchImpl.mock.calls[0]![1]?.method).toBe("GET");

    const invalid = await callError(client(async () => jsonResponse({ status: "sleepy" })).health());
    expect(invalid.kind).toBe("invalid_response");
  });
});
