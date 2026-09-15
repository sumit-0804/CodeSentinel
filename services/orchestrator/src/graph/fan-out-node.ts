import type {
  AgentKind,
  AgentReviewRequest,
  AgentReviewResponse,
  AgentRunSummary,
  Finding,
} from "@code-sentinel/contracts";

import { AgentCallError } from "../agents/agent-call-error.js";
import type { AgentClient } from "../agents/agent-client.js";
import type { AgentSkippedFiles } from "../aggregation/skipped-files.js";
import { DEADLINE_MARGIN_MS } from "./defaults.js";
import type { ReviewState } from "./review-state.js";

/** The part of `AgentClient` the fan-out uses, so tests can pass plain objects. */
export type ReviewClient = Pick<AgentClient, "review">;
export type ReviewClients = Partial<Record<AgentKind, ReviewClient>>;

interface AgentSuccess {
  response: AgentReviewResponse;
  latencyMs: number;
}

/**
 * `FanOutNode`: calls every enabled agent in parallel (FR-ORC-01) and waits for all of them with
 * `allSettled` semantics, so a slow or failing agent becomes a `timed_out` / `failed` run instead
 * of failing the review (FR-ORC-02, NFR-04). Runs are reported in `enabledAgents` order.
 */
export function createFanOutNode(clients: ReviewClients) {
  return async function fanOut(state: ReviewState): Promise<Partial<ReviewState>> {
    const request: AgentReviewRequest = {
      reviewId: state.reviewId,
      files: state.files,
      confidenceThreshold: state.confidenceThreshold,
      options: { deadlineMs: Math.max(0, state.agentTimeoutMs - DEADLINE_MARGIN_MS) },
    };
    const callOptions = {
      timeoutMs: state.agentTimeoutMs,
      ...(state.requestId ? { requestId: state.requestId } : {}),
    };

    // An async wrapper per agent, so even a client that throws synchronously settles as rejected.
    const settled = await Promise.allSettled(
      state.enabledAgents.map(async (agent): Promise<AgentSuccess | undefined> => {
        const client = clients[agent];
        if (!client) return undefined;

        const started = performance.now();
        const response = await client.review(request, callOptions);
        return { response, latencyMs: Math.round(performance.now() - started) };
      }),
    );

    const rawFindings: Finding[] = [];
    const agentRuns: AgentRunSummary[] = [];
    const agentSkippedFiles: AgentSkippedFiles[] = [];

    state.enabledAgents.forEach((agent, i) => {
      const result = settled[i]!;
      if (result.status === "rejected") {
        agentRuns.push(failedRun(agent, result.reason));
        return;
      }
      if (!result.value) {
        agentRuns.push({ agent, status: "skipped", errorCode: "agent_not_configured" });
        return;
      }

      const { response, latencyMs } = result.value;
      rawFindings.push(...response.findings.map(stripOrchestratorFields));
      if (response.skippedFiles?.length) agentSkippedFiles.push({ agent, files: response.skippedFiles });

      const run: AgentRunSummary = {
        agent,
        status: "succeeded",
        findingsCount: response.findings.length,
        latencyMs,
      };
      if (response.llm?.provider) run.llmProvider = response.llm.provider;
      agentRuns.push(run);
    });

    return { rawFindings, agentRuns, agentSkippedFiles };
  };
}

function failedRun(agent: AgentKind, reason: unknown): AgentRunSummary {
  if (!(reason instanceof AgentCallError)) {
    return { agent, status: "failed", errorCode: "unexpected_error" };
  }

  const latencyMs = reason.latencyMs;
  switch (reason.kind) {
    case "timed_out":
      return { agent, status: "timed_out", errorCode: "agent_timeout", latencyMs };
    case "http":
      return { agent, status: "failed", errorCode: `http_${reason.status ?? "error"}`, latencyMs };
    case "invalid_response":
      return { agent, status: "failed", errorCode: "invalid_response", latencyMs };
    case "network":
      return { agent, status: "failed", errorCode: "network_error", latencyMs };
  }
}

/** `id`, `similarPastIssues` and `duplicateCount` belong to the orchestrator, never to an agent. */
function stripOrchestratorFields(finding: Finding): Finding {
  const { id: _id, similarPastIssues: _similar, duplicateCount: _duplicates, ...agentOwned } = finding;
  return agentOwned;
}
