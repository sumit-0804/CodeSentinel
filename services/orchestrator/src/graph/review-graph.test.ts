import { describe, expect, it, vi } from "vitest";

import type { AgentKind, AgentReviewResponse, ReviewJobRequest, SimilarPastIssue } from "@code-sentinel/contracts";
import {
  EXAMPLE_ORGANIZATION_ID,
  EXAMPLE_REVIEW_ID,
  exampleAgentReviewResponse,
  exampleFinding,
  exampleReviewJobRequest,
} from "@code-sentinel/contracts/examples";
import { AgentCallError } from "../agents/agent-call-error.js";
import { AgentClient, type FetchLike } from "../agents/agent-client.js";
import { SimilarIssueLookup } from "../context/similar-issue-lookup.js";
import type { VectorRepository } from "../context/vector-repository.js";
import { ALL_AGENTS, DEFAULT_CONFIDENCE_THRESHOLD } from "./defaults.js";
import type { ReviewClient, ReviewClients } from "./fan-out-node.js";
import { buildReviewGraph, toInitialState } from "./review-graph.js";

function request(overrides: Partial<ReviewJobRequest> = {}): ReviewJobRequest {
  return { ...exampleReviewJobRequest, skippedFiles: [], ...overrides };
}

function responding(agent: AgentKind, response: Partial<AgentReviewResponse> = {}): ReviewClient {
  return {
    review: async () => ({
      ...exampleAgentReviewResponse,
      agent,
      findings: [{ ...exampleFinding, agent }],
      ...response,
    }),
  };
}

function failing(agent: AgentKind): ReviewClient {
  return {
    review: async () => {
      throw new AgentCallError("down", { agent, kind: "http", status: 503, latencyMs: 3 });
    },
  };
}

/** A real client whose fetch only settles when the timeout aborts it. */
function silentAgent(agent: AgentKind): AgentClient {
  const fetchImpl: FetchLike = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
  return new AgentClient({ agent, baseUrl: `http://${agent}-agent.internal`, timeoutMs: 60000, fetch: fetchImpl });
}

async function run(clients: ReviewClients, jobRequest: ReviewJobRequest, lookup?: SimilarIssueLookup) {
  const { run: runReview } = buildReviewGraph({
    clients,
    ...(lookup ? { similarIssueLookup: lookup } : {}),
  });
  return runReview({ reviewId: EXAMPLE_REVIEW_ID, requestId: "req-1", request: jobRequest });
}

describe("buildReviewGraph", () => {
  it("collapses the same finding from two agents into one completed report", async () => {
    const report = await run(
      { security: responding("security"), logic: responding("logic") },
      request({ enabledAgents: ["security", "logic"], confidenceThreshold: 0.65, includeSimilarPastIssues: false }),
    );

    expect(report.reviewId).toBe(EXAMPLE_REVIEW_ID);
    expect(report.status).toBe("completed");
    expect(report.confidenceThreshold).toBe(0.65);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.duplicateCount).toBe(2);
    expect(report.summary.criticalCount).toBe(1);
    expect(report.agentRuns.map((r) => r.status)).toEqual(["succeeded", "succeeded"]);
    expect(report).not.toHaveProperty("skippedFiles");
  });

  it("returns a partial report when the documentation agent times out", async () => {
    const started = Date.now();

    const report = await run(
      {
        security: responding("security"),
        logic: responding("logic", {
          findings: [{ ...exampleFinding, agent: "logic", ruleId: "logic/off-by-one", severity: "warning" }],
        }),
        documentation: silentAgent("documentation"),
      },
      request({ enabledAgents: ["security", "logic", "documentation"], agentTimeoutMs: 40 }),
    );

    expect(Date.now() - started).toBeLessThan(2000);
    expect(report.status).toBe("partial");
    expect(report.agentRuns[2]).toMatchObject({
      agent: "documentation",
      status: "timed_out",
      errorCode: "agent_timeout",
    });
    expect(report.findings.map((f) => f.ruleId)).toEqual(["security/sql-injection", "logic/off-by-one"]);
  });

  it("returns a failed report with no findings when every agent fails", async () => {
    const report = await run(
      { security: failing("security"), style: failing("style"), logic: failing("logic") },
      request(),
    );

    expect(report.status).toBe("failed");
    expect(report.findings).toEqual([]);
    expect(report.agentRuns.map((r) => r.errorCode)).toEqual(["http_503", "http_503", "http_503"]);
  });

  it("only looks up similar past issues when the job asks for them", async () => {
    const similar: SimilarPastIssue[] = [
      { findingId: "3f0e2a5c-9d1b-4f7a-8c6e-5b4a3d2c1e0f", similarityScore: 0.91, title: "SQL built from a format string" },
    ];
    const vectors: VectorRepository = {
      index: vi.fn(async () => undefined),
      querySimilar: vi.fn(async () => similar),
    };
    const lookup = new SimilarIssueLookup(vectors);
    const clients = { security: responding("security") };

    const without = await run(clients, request({ enabledAgents: ["security"], includeSimilarPastIssues: false }), lookup);
    expect(vectors.querySimilar).not.toHaveBeenCalled();
    expect(without.findings[0]).not.toHaveProperty("similarPastIssues");

    const withLookup = await run(clients, request({ enabledAgents: ["security"], includeSimilarPastIssues: true }), lookup);
    expect(vectors.querySimilar).toHaveBeenCalledWith(expect.objectContaining({ ruleId: exampleFinding.ruleId }), EXAMPLE_ORGANIZATION_ID, 3);
    expect(withLookup.findings[0]?.similarPastIssues).toEqual(similar);
  });

  it("merges gateway and agent skips into the report", async () => {
    const report = await run(
      {
        security: responding("security", { skippedFiles: [{ path: "src/big.py", reason: "too_large" }] }),
        logic: responding("logic", { skippedFiles: [{ path: "src/big.py", reason: "too_large" }] }),
      },
      request({
        enabledAgents: ["security", "logic"],
        skippedFiles: [{ path: "package-lock.json", reason: "generated_file" }],
      }),
    );

    expect(report.skippedFiles).toEqual([
      { path: "package-lock.json", reason: "generated_file" },
      { path: "src/big.py", reason: "too_large", agents: ["security", "logic"] },
    ]);
  });
});

describe("toInitialState", () => {
  it("defaults enabled agents to all five and the threshold to the platform default", () => {
    const { enabledAgents: _agents, confidenceThreshold: _threshold, ...rest } = exampleReviewJobRequest;

    const state = toInitialState({ reviewId: EXAMPLE_REVIEW_ID, request: rest });

    expect(state.enabledAgents).toEqual([...ALL_AGENTS]);
    expect(state.confidenceThreshold).toBe(DEFAULT_CONFIDENCE_THRESHOLD);
    expect(state.gatewaySkippedFiles).toEqual(exampleReviewJobRequest.skippedFiles);
    expect(state.organizationId).toBe(EXAMPLE_ORGANIZATION_ID);
  });
});
