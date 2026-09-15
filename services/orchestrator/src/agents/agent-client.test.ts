import { describe, expect, it, vi } from "vitest";

import {
  exampleAgentReviewRequest,
  exampleAgentReviewResponse,
} from "@code-sentinel/contracts/examples";
import { AgentCallError } from "./agent-call-error.js";
import { AgentClient, type FetchLike } from "./agent-client.js";

const BASE_URL = "http://security-agent.internal:8081/";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function client(fetchImpl: FetchLike, overrides: { serviceToken?: string; timeoutMs?: number } = {}) {
  return new AgentClient({
    agent: "security",
    baseUrl: BASE_URL,
    serviceToken: "service-token",
    timeoutMs: 1000,
    fetch: fetchImpl,
    ...overrides,
  });
}

/** Resolves only when the signal aborts, the way real fetch behaves against a silent server. */
const hangingFetch: FetchLike = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

async function callError(promise: Promise<unknown>): Promise<AgentCallError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AgentCallError);
  return error as AgentCallError;
}

describe("AgentClient.review", () => {
  it("posts the request with bearer token and request id, and returns the validated response", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(exampleAgentReviewResponse));

    const response = await client(fetchImpl).review(exampleAgentReviewRequest, { requestId: "req-123" });

    expect(response).toEqual(exampleAgentReviewResponse);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://security-agent.internal:8081/v1/review");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual(exampleAgentReviewRequest);
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer service-token",
      "X-Request-Id": "req-123",
      "Content-Type": "application/json",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("omits Authorization when no token is configured", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(exampleAgentReviewResponse));

    await client(fetchImpl, { serviceToken: "" }).review(exampleAgentReviewRequest);

    const headers = fetchImpl.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers).not.toHaveProperty("Authorization");
    expect(headers).not.toHaveProperty("X-Request-Id");
  });

  it("maps a 500 to an http error with the status", async () => {
    const error = await callError(
      client(async () => jsonResponse({ code: "boom", message: "boom" }, 500)).review(exampleAgentReviewRequest),
    );

    expect(error.kind).toBe("http");
    expect(error.status).toBe(500);
    expect(error.agent).toBe("security");
    expect(error.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("maps malformed JSON to invalid_response", async () => {
    const error = await callError(
      client(async () => new Response("{not json", { status: 200 })).review(exampleAgentReviewRequest),
    );

    expect(error.kind).toBe("invalid_response");
  });

  it("maps a body missing agent to invalid_response", async () => {
    const { agent: _agent, ...withoutAgent } = exampleAgentReviewResponse;

    const error = await callError(client(async () => jsonResponse(withoutAgent)).review(exampleAgentReviewRequest));

    expect(error.kind).toBe("invalid_response");
  });

  it("rejects a response that names a different agent", async () => {
    const error = await callError(
      client(async () => jsonResponse({ ...exampleAgentReviewResponse, agent: "logic" })).review(
        exampleAgentReviewRequest,
      ),
    );

    expect(error.kind).toBe("invalid_response");
  });

  it("times out a fetch that never resolves", async () => {
    const started = Date.now();

    const error = await callError(client(hangingFetch, { timeoutMs: 30 }).review(exampleAgentReviewRequest));

    expect(error.kind).toBe("timed_out");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("lets a per-call timeout override the client default", async () => {
    const error = await callError(
      client(hangingFetch, { timeoutMs: 60000 }).review(exampleAgentReviewRequest, { timeoutMs: 20 }),
    );

    expect(error.kind).toBe("timed_out");
  });

  it("maps a fetch TypeError to network", async () => {
    const error = await callError(
      client(async () => {
        throw new TypeError("fetch failed");
      }).review(exampleAgentReviewRequest),
    );

    expect(error.kind).toBe("network");
    expect(error.cause).toBeInstanceOf(TypeError);
  });
});

describe("AgentClient.capabilities and health", () => {
  it("gets /v1/capabilities and validates it", async () => {
    const capabilities = { agent: "security", version: "1.0.0", languages: ["python"], usesLlm: true };
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(capabilities));

    await expect(client(fetchImpl).capabilities()).resolves.toEqual(capabilities);
    expect(fetchImpl.mock.calls[0]![0]).toBe("http://security-agent.internal:8081/v1/capabilities");
    expect(fetchImpl.mock.calls[0]![1]?.method).toBe("GET");
  });

  it("rejects capabilities missing required fields", async () => {
    const error = await callError(client(async () => jsonResponse({ agent: "security" })).capabilities());

    expect(error.kind).toBe("invalid_response");
  });

  it("gets /healthz and validates it", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ status: "ok", version: "1.0.0" }));

    await expect(client(fetchImpl).health()).resolves.toEqual({ status: "ok", version: "1.0.0" });
    expect(fetchImpl.mock.calls[0]![0]).toBe("http://security-agent.internal:8081/healthz");
  });

  it("returns a 503 Health body as a not-ready answer", async () => {
    const body = { status: "unavailable", checks: { llmProvider: "unavailable" } };

    await expect(client(async () => jsonResponse(body, 503)).health()).resolves.toEqual(body);
  });

  it("rejects a health body with an unknown status", async () => {
    const error = await callError(client(async () => jsonResponse({ status: "sleepy" })).health());

    expect(error.kind).toBe("invalid_response");
  });
});
