import type {
  AgentKind,
  AgentReviewRequest,
  AgentReviewResponse,
  AgentRunSummary,
  ChangedFile,
  Finding,
  SkippedFile,
} from "@code-sentinel/contracts";
import type { LlmProviderName } from "@code-sentinel/llm";

import { AgentCallError } from "../agents/agent-call-error.js";
import type { AgentClient } from "../agents/agent-client.js";
import type { AgentSkippedFiles } from "../aggregation/skipped-files.js";
import { LLM_AGENTS, reserveBatch, settleCall, type LlmRouting } from "../budget/llm-routing.js";
import { planLlmReview } from "../budget/plan.js";
import { DEADLINE_MARGIN_MS } from "./defaults.js";
import type { ReviewState } from "./review-state.js";

/** The part of `AgentClient` the fan-out uses, so tests can pass plain objects. */
export type ReviewClient = Pick<AgentClient, "review">;
export type ReviewClients = Partial<Record<AgentKind, ReviewClient>>;

/** The slice of the LangGraph node config the fan-out reads: the run's abort signal. */
export interface NodeRunConfig {
  signal?: AbortSignal;
}

interface AgentOutcome {
  run: AgentRunSummary;
  findings: Finding[];
  skipped: SkippedFile[];
}

type BatchResult = { ok: true; response: AgentReviewResponse } | { ok: false; error: unknown };

/**
 * `FanOutNode`: calls every enabled agent in parallel (FR-ORC-01). A slow or failing agent becomes
 * a `timed_out` / `failed` run instead of failing the review (FR-ORC-02, NFR-04). With `routing`,
 * LLM agents get their files in planned batches, each sent only after quota was reserved on Groq
 * or Gemini (`plans/large-diffs.md`). Runs are reported in `enabledAgents` order.
 */
export function createFanOutNode(clients: ReviewClients, routing?: LlmRouting) {
  return async function fanOut(state: ReviewState, config?: NodeRunConfig): Promise<Partial<ReviewState>> {
    const signal = config?.signal;
    const outcomes = await Promise.all(
      state.enabledAgents.map(async (agent): Promise<AgentOutcome> => {
        const client = clients[agent];
        if (!client) return { run: { agent, status: "skipped", errorCode: "agent_not_configured" }, findings: [], skipped: [] };
        if (routing && LLM_AGENTS.has(agent)) return runLlmAgent(agent, client, state, routing, signal);
        return runOnce(agent, client, state, signal);
      }),
    );

    const agentSkippedFiles: AgentSkippedFiles[] = [];
    state.enabledAgents.forEach((agent, i) => {
      const { skipped } = outcomes[i]!;
      if (skipped.length) agentSkippedFiles.push({ agent, files: skipped });
    });
    return {
      rawFindings: outcomes.flatMap((outcome) => outcome.findings),
      agentRuns: outcomes.map((outcome) => outcome.run),
      agentSkippedFiles,
    };
  };
}

/** One request with every file: the Style Agent, or any agent when no LLM provider is configured. */
async function runOnce(agent: AgentKind, client: ReviewClient, state: ReviewState, signal?: AbortSignal): Promise<AgentOutcome> {
  const started = performance.now();
  const result = await send(client, state, state.files, state.agentTimeoutMs, undefined, signal);
  if (!result.ok) return { run: failedRun(agent, result.error), findings: [], skipped: [] };

  const { response } = result;
  const run: AgentRunSummary = {
    agent,
    status: "succeeded",
    findingsCount: response.findings.length,
    latencyMs: Math.round(performance.now() - started),
  };
  if (response.llm?.provider) run.llmProvider = response.llm.provider;
  return { run, findings: response.findings.map(stripOrchestratorFields), skipped: response.skippedFiles ?? [] };
}

/**
 * An LLM agent: plan batches, reserve each on Groq or Gemini (waiting until the deadline if both
 * are full), send the reserved batches in parallel, then merge them into one run.
 */
async function runLlmAgent(
  agent: AgentKind,
  client: ReviewClient,
  state: ReviewState,
  routing: LlmRouting,
  signal?: AbortSignal,
): Promise<AgentOutcome> {
  const started = routing.now();
  const deadlineAt = started + Math.max(state.agentTimeoutMs, routing.llmAgentTimeoutMs);
  const plan = planLlmReview(state.files, routing.plan);
  const skipped: SkippedFile[] = [...plan.skipped];
  const calls: Promise<BatchResult>[] = [];
  let exhausted = false;

  for (const batch of plan.batches) {
    const reserved = exhausted ? undefined : await reserveBatch(routing, batch.tokens, deadlineAt, signal);
    if (!reserved) {
      exhausted = true;
      skipped.push(...batch.files.map((file) => ({ path: file.path, reason: "over_budget" as const })));
      continue;
    }
    const timeoutMs = Math.max(1, deadlineAt - routing.now());
    calls.push(
      send(client, state, batch.files, timeoutMs, reserved.provider, signal).then((result) => {
        if (result.ok) settleCall(routing, reserved, result.response.llm);
        // A failed call keeps its estimate: the provider may have spent the tokens.
        return result;
      }),
    );
  }

  const results = await Promise.all(calls);
  const responses = results.flatMap((result) => (result.ok ? [result.response] : []));
  const firstFailure = results.find((result) => !result.ok);
  const findings = responses.flatMap((response) => response.findings.map(stripOrchestratorFields));
  skipped.push(...responses.flatMap((response) => response.skippedFiles ?? []));
  const latencyMs = Math.round(routing.now() - started);

  if (calls.length === 0) {
    const errorCode = exhausted ? "llm_quota_exhausted" : "no_reviewable_files";
    return { run: { agent, status: "skipped", errorCode }, findings, skipped };
  }
  if (responses.length === 0) return { run: { ...failedRun(agent, firstFailure!.error), latencyMs }, findings, skipped };

  // Some batches answered: keep their findings, but let a failed batch or a quota gap mark the review partial.
  const run: AgentRunSummary = firstFailure
    ? { ...failedRun(agent, firstFailure.error), findingsCount: findings.length, latencyMs }
    : { agent, status: "succeeded", findingsCount: findings.length, latencyMs };
  if (!firstFailure && exhausted) run.errorCode = "llm_quota_exhausted";
  const providers = [...new Set(responses.flatMap((response) => (response.llm?.provider ? [response.llm.provider] : [])))];
  if (providers.length) run.llmProvider = providers.join(",");
  return { run, findings, skipped };
}

async function send(
  client: ReviewClient,
  state: ReviewState,
  files: ChangedFile[],
  timeoutMs: number,
  llmProvider: LlmProviderName | undefined,
  signal: AbortSignal | undefined,
): Promise<BatchResult> {
  const request: AgentReviewRequest = {
    reviewId: state.reviewId,
    files,
    confidenceThreshold: state.confidenceThreshold,
    options: {
      deadlineMs: Math.max(0, timeoutMs - DEADLINE_MARGIN_MS),
      ...(llmProvider ? { llmProvider } : {}),
    },
  };
  try {
    const response = await client.review(request, {
      timeoutMs,
      ...(state.requestId ? { requestId: state.requestId } : {}),
      // A cancelled job aborts the run, which aborts every agent call still in flight.
      ...(signal ? { signal } : {}),
    });
    return { ok: true, response };
  } catch (error) {
    return { ok: false, error };
  }
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
