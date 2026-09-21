import {
  AgentReviewResponseSchema,
  type AgentReviewRequest,
  type AgentReviewResponse,
  type ChangedFile,
  type Language,
  type SkippedFile,
} from "@code-sentinel/contracts";
import { estimateTokens, LlmUnavailableError, type LlmClient } from "@code-sentinel/llm";
import type { Logger } from "@code-sentinel/service-kit";

import type { AgentContext, ReviewAgent } from "./agent.js";

export interface RunReviewOptions {
  requestId: string;
  logger: Logger;
  llm?: LlmClient;
  /** Aborted by the HTTP layer when the orchestrator hangs up. */
  signal?: AbortSignal;
  now?: () => number;
}

/**
 * The shared part of `POST /v1/review`: skip what the agent cannot take, run `analyze` once on the
 * rest with a deadline, and return a response that passes `AgentReviewResponseSchema`.
 */
export async function runReview(
  agent: ReviewAgent,
  request: AgentReviewRequest,
  options: RunReviewOptions,
): Promise<AgentReviewResponse> {
  const now = options.now ?? Date.now;
  const started = now();
  const deadlineMs = request.options?.deadlineMs;
  const deadlineAt = deadlineMs === undefined ? Infinity : started + deadlineMs;

  const provider = request.options?.llmProvider;
  if (provider && !options.llm?.has(provider)) {
    // The orchestrator reserved quota we cannot use; fail loudly so the key gets fixed.
    throw new LlmUnavailableError(provider);
  }

  const skipped: SkippedFile[] = [];
  const eligible: ChangedFile[] = [];
  for (const file of request.files) {
    const language: Language = file.language !== "unknown" ? file.language : (request.language ?? "unknown");
    if (!agent.languages.includes(language)) skipped.push({ path: file.path, reason: "unsupported_language" });
    else if (estimateTokens(file.patch) > agent.maxFileTokens) skipped.push({ path: file.path, reason: "too_large" });
    else eligible.push({ ...file, language });
  }

  const timers: AbortSignal[] = Number.isFinite(deadlineAt) ? [AbortSignal.timeout(Math.max(1, deadlineAt - started))] : [];
  const signal = AbortSignal.any([...timers, ...(options.signal ? [options.signal] : [])]);
  const context: AgentContext = {
    reviewId: request.reviewId,
    requestId: options.requestId,
    logger: options.logger,
    signal,
    deadlineAt,
    options: request.options ?? {},
    ...(provider && options.llm ? { llm: { client: options.llm, provider } } : {}),
  };

  const result = eligible.length ? await agent.analyze(eligible, context) : { findings: [] };
  const agentSkipped = result.skipped ?? [];
  const agentSkippedPaths = new Set(agentSkipped.map((file) => file.path));

  const response: AgentReviewResponse = {
    reviewId: request.reviewId,
    agent: agent.kind,
    serviceVersion: agent.version,
    findings: result.findings.map((finding) => ({ ...finding, agent: agent.kind })),
    analyzedFileCount: eligible.filter((file) => !agentSkippedPaths.has(file.path)).length,
    skippedFiles: [...skipped, ...agentSkipped],
    latencyMs: Math.round(now() - started),
  };
  if (result.llm) response.llm = result.llm;
  // An agent bug should surface here as a 500, not as an invalid_response at the orchestrator.
  return AgentReviewResponseSchema.parse(response);
}

/**
 * For agents that work file by file: calls `analyzeFile` in order until the deadline, and lists
 * every file it did not reach as `over_budget`.
 */
export async function analyzePerFile<T>(
  files: ChangedFile[],
  context: Pick<AgentContext, "signal">,
  analyzeFile: (file: ChangedFile) => Promise<T[]> | T[],
): Promise<{ results: T[]; skipped: SkippedFile[] }> {
  const results: T[] = [];
  const skipped: SkippedFile[] = [];
  for (const file of files) {
    if (context.signal.aborted) {
      skipped.push({ path: file.path, reason: "over_budget" });
      continue;
    }
    results.push(...(await analyzeFile(file)));
  }
  return { results, skipped };
}
