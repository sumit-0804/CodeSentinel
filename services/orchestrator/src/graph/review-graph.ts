import { END, START, StateGraph } from "@langchain/langgraph";

import type { CombinedReport, ReviewJobRequest } from "@code-sentinel/contracts";
import type { SimilarIssueLookup } from "../context/similar-issue-lookup.js";
import { aggregateNode } from "./aggregate-node.js";
import { createContextNode } from "./context-node.js";
import { ALL_AGENTS, DEFAULT_CONFIDENCE_THRESHOLD } from "./defaults.js";
import { createFanOutNode, type ReviewClients } from "./fan-out-node.js";
import { ReviewStateAnnotation, type ReviewState } from "./review-state.js";
import { thresholdNode } from "./threshold-node.js";

export interface ReviewGraphDeps {
  /** One client per configured agent; enabled agents without one are recorded as `skipped`. */
  clients: ReviewClients;
  /** Omit until a vector store is wired; the context node is then a no-op. */
  similarIssueLookup?: SimilarIssueLookup;
}

export interface ReviewRunInput {
  reviewId: string;
  /** From the gateway's `X-Request-Id`, forwarded to every agent (NFR-12). */
  requestId?: string;
  request: ReviewJobRequest;
}

/** The `ReviewState` a run starts from, with job defaults applied. */
export function toInitialState(input: ReviewRunInput): ReviewState {
  const { request } = input;
  return {
    reviewId: input.reviewId,
    organizationId: request.organizationId,
    requestId: input.requestId,
    files: request.files,
    gatewaySkippedFiles: request.skippedFiles ?? [],
    enabledAgents: request.enabledAgents ?? [...ALL_AGENTS],
    confidenceThreshold: request.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
    agentTimeoutMs: request.agentTimeoutMs,
    includeSimilarPastIssues: request.includeSimilarPastIssues,
    rawFindings: [],
    agentRuns: [],
    agentSkippedFiles: [],
    report: undefined,
  };
}

/**
 * `ReviewGraph`: `START → fanOut → aggregate → context → threshold → END`, the node order in
 * `class_orchestrator.mmd`. `run()` executes one review and returns its `CombinedReport`.
 */
export function buildReviewGraph(deps: ReviewGraphDeps) {
  const graph = new StateGraph(ReviewStateAnnotation)
    .addNode("fanOut", createFanOutNode(deps.clients))
    .addNode("aggregate", aggregateNode)
    .addNode("context", createContextNode(deps.similarIssueLookup))
    .addNode("threshold", thresholdNode)
    .addEdge(START, "fanOut")
    .addEdge("fanOut", "aggregate")
    .addEdge("aggregate", "context")
    .addEdge("context", "threshold")
    .addEdge("threshold", END)
    .compile();

  async function run(input: ReviewRunInput): Promise<CombinedReport> {
    const state = await graph.invoke(toInitialState(input));
    if (!state.report) throw new Error(`Review ${input.reviewId} finished without a report`);
    return state.report;
  }

  return { graph, run };
}
