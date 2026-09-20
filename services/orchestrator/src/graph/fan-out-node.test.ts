import { describe, expect, it, vi } from "vitest";

import type { AgentKind, AgentReviewResponse, Finding } from "@code-sentinel/contracts";
import {
  EXAMPLE_ORGANIZATION_ID,
  EXAMPLE_REVIEW_ID,
  exampleAgentReviewResponse,
  exampleChangedFile,
  exampleFinding,
} from "@code-sentinel/contracts/examples";
import { QuotaBudget } from "@code-sentinel/llm";
import { AgentCallError } from "../agents/agent-call-error.js";
import type { LlmRouting } from "../budget/llm-routing.js";
import { createFanOutNode, type ReviewClient } from "./fan-out-node.js";
import type { ReviewState } from "./review-state.js";

function state(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    reviewId: EXAMPLE_REVIEW_ID,
    organizationId: EXAMPLE_ORGANIZATION_ID,
    requestId: "req-42",
    files: [exampleChangedFile],
    gatewaySkippedFiles: [],
    enabledAgents: ["security", "logic", "documentation"],
    confidenceThreshold: 0.8,
    agentTimeoutMs: 20000,
    includeSimilarPastIssues: false,
    rawFindings: [],
    agentRuns: [],
    agentSkippedFiles: [],
    report: undefined,
    ...overrides,
  };
}

function respondingClient(agent: AgentKind, response: Partial<AgentReviewResponse> = {}) {
  return {
    review: vi.fn<ReviewClient["review"]>(async () => ({ ...exampleAgentReviewResponse, agent, ...response })),
  };
}

function failingClient(error: unknown): ReviewClient {
  return { review: async () => Promise.reject(error) };
}

describe("createFanOutNode", () => {
  it("records one run per enabled agent in order, with findings only from successful agents", async () => {
    const orchestratorOwned: Finding = {
      ...exampleFinding,
      id: "3f0e2a5c-9d1b-4f7a-8c6e-5b4a3d2c1e0f",
      duplicateCount: 4,
      similarPastIssues: [{ findingId: "3f0e2a5c-9d1b-4f7a-8c6e-5b4a3d2c1e0f", similarityScore: 0.9, title: "x" }],
    };
    const fanOut = createFanOutNode({
      security: respondingClient("security", { findings: [orchestratorOwned] }),
      logic: failingClient(new AgentCallError("slow", { agent: "logic", kind: "timed_out", latencyMs: 20000 })),
      documentation: failingClient(
        new AgentCallError("down", { agent: "documentation", kind: "http", status: 503, latencyMs: 12 }),
      ),
    });

    const update = await fanOut(state());

    expect(update.agentRuns).toEqual([
      { agent: "security", status: "succeeded", findingsCount: 1, latencyMs: expect.any(Number), llmProvider: "groq" },
      { agent: "logic", status: "timed_out", errorCode: "agent_timeout", latencyMs: 20000 },
      { agent: "documentation", status: "failed", errorCode: "http_503", latencyMs: 12 },
    ]);
    expect(update.rawFindings).toEqual([exampleFinding]);
    expect(update.rawFindings?.[0]).not.toHaveProperty("id");
    expect(update.rawFindings?.[0]).not.toHaveProperty("duplicateCount");
    expect(update.rawFindings?.[0]).not.toHaveProperty("similarPastIssues");
  });

  it("maps the remaining AgentCallError kinds and unexpected errors", async () => {
    const fanOut = createFanOutNode({
      security: failingClient(new AgentCallError("bad", { agent: "security", kind: "invalid_response", latencyMs: 5 })),
      style: failingClient(new AgentCallError("refused", { agent: "style", kind: "network", latencyMs: 1 })),
      logic: {
        review: () => {
          throw new Error("bug");
        },
      },
    });

    const update = await fanOut(state({ enabledAgents: ["security", "style", "logic"] }));

    expect(update.agentRuns).toEqual([
      { agent: "security", status: "failed", errorCode: "invalid_response", latencyMs: 5 },
      { agent: "style", status: "failed", errorCode: "network_error", latencyMs: 1 },
      { agent: "logic", status: "failed", errorCode: "unexpected_error" },
    ]);
  });

  it("marks an enabled agent without a client as skipped", async () => {
    const fanOut = createFanOutNode({ security: respondingClient("security") });

    const update = await fanOut(state({ enabledAgents: ["security", "performance"] }));

    expect(update.agentRuns?.[1]).toEqual({
      agent: "performance",
      status: "skipped",
      errorCode: "agent_not_configured",
    });
  });

  it("sends deadlineMs as the timeout minus the margin and forwards the request id", async () => {
    const security = respondingClient("security");
    const fanOut = createFanOutNode({ security });

    await fanOut(state({ enabledAgents: ["security"], agentTimeoutMs: 15000 }));

    expect(security.review).toHaveBeenCalledWith(
      {
        reviewId: EXAMPLE_REVIEW_ID,
        files: [exampleChangedFile],
        confidenceThreshold: 0.8,
        options: { deadlineMs: 13000 },
      },
      { requestId: "req-42", timeoutMs: 15000 },
    );
  });

  it("forwards the run's abort signal to every agent call", async () => {
    const security = respondingClient("security");
    const controller = new AbortController();

    await createFanOutNode({ security })(state({ enabledAgents: ["security"] }), { signal: controller.signal });

    expect(security.review.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("collects agent skips under the agent that reported them", async () => {
    const fanOut = createFanOutNode({
      security: respondingClient("security", { skippedFiles: [{ path: "src/big.py", reason: "too_large" }] }),
      logic: respondingClient("logic", { skippedFiles: [] }),
    });

    const update = await fanOut(state({ enabledAgents: ["security", "logic"] }));

    expect(update.agentSkippedFiles).toEqual([
      { agent: "security", files: [{ path: "src/big.py", reason: "too_large" }] },
    ]);
  });

  it("calls the agents in parallel", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const tracked = (agent: AgentKind): ReviewClient => ({
      review: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return { ...exampleAgentReviewResponse, agent };
      },
    });
    const fanOut = createFanOutNode({
      security: tracked("security"),
      logic: tracked("logic"),
      documentation: tracked("documentation"),
    });

    await fanOut(state());

    expect(maxInFlight).toBe(3);
  });
});

/** Real budgets on a fake clock; `sleep` advances the clock. Groq takes one ~3K batch a minute. */
function routing({ gemini = true } = {}): LlmRouting {
  let now = Date.parse("2026-09-27T10:00:00.000Z");
  const clock = () => new Date(now);
  return {
    budgets: {
      groq: new QuotaBudget({ requestsPerMinute: 30, tokensPerMinute: 8000, requestsPerDay: 1000, tokensPerDay: 200000 }, { headroom: 0.8, now: clock }),
      ...(gemini ? { gemini: new QuotaBudget({ requestsPerMinute: 15, tokensPerMinute: 250000, requestsPerDay: 500 }, { headroom: 0.8, now: clock }) } : {}),
    },
    plan: { maxFileTokens: 6000, maxBatchTokens: 3000, reviewMaxTokens: 24000 },
    overheadTokens: 3000,
    groqMaxBatchTokens: 3400,
    llmAgentTimeoutMs: 45000,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };
}

const pyFile = (path: string, tokens: number) => ({ ...exampleChangedFile, path, patch: "x".repeat(tokens * 3) });

describe("createFanOutNode with LLM routing", () => {
  it("sends each batch with the provider it reserved, Groq first, and merges them into one run", async () => {
    const security = respondingClient("security");
    const fanOut = createFanOutNode({ security }, routing());

    const update = await fanOut(state({ enabledAgents: ["security"], files: [pyFile("a.py", 2000), pyFile("b.py", 2500)] }));

    const calls = security.review.mock.calls;
    expect(calls.map(([request]) => [request.files.map((f) => f.path), request.options?.llmProvider])).toEqual([
      [["a.py"], "groq"],
      [["b.py"], "gemini"],
    ]);
    expect(calls[0]?.[1]).toMatchObject({ timeoutMs: 45000 });
    expect(calls[0]?.[0].options?.deadlineMs).toBe(43000);
    expect(update.agentRuns).toEqual([
      { agent: "security", status: "succeeded", findingsCount: 2, latencyMs: 0, llmProvider: "groq" },
    ]);
    expect(update.rawFindings).toHaveLength(2);
  });

  it("gives the Style Agent one request with no llmProvider and the job's own timeout", async () => {
    const style = respondingClient("style", { llm: undefined });

    await createFanOutNode({ style }, routing())(state({ enabledAgents: ["style"], agentTimeoutMs: 20000 }));

    expect(style.review).toHaveBeenCalledTimes(1);
    expect(style.review.mock.calls[0]?.[0].options).toEqual({ deadlineMs: 18000 });
    expect(style.review.mock.calls[0]?.[1]).toMatchObject({ timeoutMs: 20000 });
  });

  it("marks the agent llm_quota_exhausted and its files over_budget when no quota frees up in time", async () => {
    const r = routing({ gemini: false });
    r.budgets.groq!.charge({ requests: 1, tokens: 6400 });
    const security = respondingClient("security");

    const update = await createFanOutNode({ security }, r)(state({ enabledAgents: ["security"], files: [pyFile("a.py", 100)] }));

    expect(security.review).not.toHaveBeenCalled();
    expect(update.agentRuns).toEqual([{ agent: "security", status: "skipped", errorCode: "llm_quota_exhausted" }]);
    expect(update.agentSkippedFiles).toEqual([{ agent: "security", files: [{ path: "a.py", reason: "over_budget" }] }]);
  });

  it("keeps the batches that answered when a later batch cannot be reserved", async () => {
    const security = respondingClient("security");

    const update = await createFanOutNode({ security }, routing({ gemini: false }))(
      state({ enabledAgents: ["security"], agentTimeoutMs: 1000, files: [pyFile("a.py", 2000), pyFile("b.py", 2500)] }),
    );

    expect(security.review).toHaveBeenCalledTimes(1);
    expect(update.agentRuns?.[0]).toMatchObject({ status: "succeeded", errorCode: "llm_quota_exhausted", findingsCount: 1 });
    expect(update.agentSkippedFiles).toEqual([{ agent: "security", files: [{ path: "b.py", reason: "over_budget" }] }]);
  });

  it("reports planner skips and a failed batch without losing the other batch's findings", async () => {
    let call = 0;
    const security: ReviewClient = {
      review: async (request) => {
        call++;
        if (call === 2) throw new AgentCallError("slow", { agent: "security", kind: "timed_out", latencyMs: 45000 });
        return { ...exampleAgentReviewResponse, findings: [{ ...exampleFinding, location: { ...exampleFinding.location, filePath: request.files[0]!.path } }] };
      },
    };

    const update = await createFanOutNode({ security }, routing())(
      state({ enabledAgents: ["security"], files: [pyFile("a.py", 2000), pyFile("b.py", 2500), pyFile("huge.py", 7000)] }),
    );

    expect(update.agentRuns?.[0]).toMatchObject({ status: "timed_out", errorCode: "agent_timeout", findingsCount: 1 });
    expect(update.rawFindings).toHaveLength(1);
    expect(update.agentSkippedFiles).toEqual([{ agent: "security", files: [{ path: "huge.py", reason: "too_large" }] }]);
  });
});
