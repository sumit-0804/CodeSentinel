import { describe, expect, it, vi } from "vitest";

import type { AgentKind, AgentReviewResponse, Finding } from "@code-sentinel/contracts";
import {
  EXAMPLE_ORGANIZATION_ID,
  EXAMPLE_REVIEW_ID,
  exampleAgentReviewResponse,
  exampleChangedFile,
  exampleFinding,
} from "@code-sentinel/contracts/examples";
import { AgentCallError } from "../agents/agent-call-error.js";
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
      { agent: "security", status: "succeeded", findingsCount: 1, latencyMs: expect.any(Number), llmProvider: "gemini" },
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
