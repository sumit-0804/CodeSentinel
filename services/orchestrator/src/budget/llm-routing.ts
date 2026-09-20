import type { AgentKind, AgentLlmUsage } from "@code-sentinel/contracts";
import { QuotaBudget, type LlmLimits, type LlmProviderName, type Reservation } from "@code-sentinel/llm";

import type { PlanLimits } from "./plan.js";

/** Agents that call an LLM; the Style Agent never does (NFR-07). */
export const LLM_AGENTS: ReadonlySet<AgentKind> = new Set(["security", "performance", "logic", "documentation"]);

/** Groq first, then Gemini (`plans/llm-agents.md`). */
const PROVIDER_ORDER: readonly LlmProviderName[] = ["groq", "gemini"];

/** A reservation is not worth waiting for unless this much time is left for the call itself. */
export const MIN_CALL_MS = 5_000;

export interface LlmRouting {
  budgets: Partial<Record<LlmProviderName, QuotaBudget>>;
  plan: PlanLimits;
  /** Added to every call's diff tokens: system prompt allowance plus the output cap. */
  overheadTokens: number;
  /** Largest diff one Groq call can carry within Groq's per-minute token limit. */
  groqMaxBatchTokens: number;
  /** LLM agents get at least this timeout (a Gemini call can take over 20 s on the free tier). */
  llmAgentTimeoutMs: number;
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface ReservedCall {
  provider: LlmProviderName;
  reservation: Reservation;
}

/** One budget per configured provider; undefined when no LLM provider is configured at all. */
export function createLlmRouting(limits: LlmLimits, llmAgentTimeoutMs: number): LlmRouting | undefined {
  const budgets: Partial<Record<LlmProviderName, QuotaBudget>> = {};
  if (limits.groq) budgets.groq = new QuotaBudget(limits.groq.limits, { headroom: limits.headroom });
  if (limits.gemini) budgets.gemini = new QuotaBudget(limits.gemini.limits, { headroom: limits.headroom });
  if (!budgets.groq && !budgets.gemini) return undefined;

  const overheadTokens = limits.promptReserveTokens + limits.maxOutputTokens;
  const groqCallTokens = limits.groq ? Math.floor(limits.groq.limits.tokensPerMinute * limits.headroom) : 0;
  return {
    budgets,
    plan: { maxFileTokens: limits.maxFileTokens, maxBatchTokens: limits.maxBatchTokens, reviewMaxTokens: limits.reviewMaxTokens },
    overheadTokens,
    groqMaxBatchTokens: Math.max(0, groqCallTokens - overheadTokens),
    llmAgentTimeoutMs,
    now: Date.now,
    sleep,
  };
}

/**
 * Reserves one call for a batch: on Groq when the batch fits Groq's per-call cap and its quota has
 * room now, otherwise on Gemini, otherwise waits for the earliest provider to free up. Returns
 * undefined when nothing can fit before `deadlineAt` (the agent is then `llm_quota_exhausted`).
 */
export async function reserveBatch(
  routing: LlmRouting,
  batchTokens: number,
  deadlineAt: number,
  signal?: AbortSignal,
): Promise<ReservedCall | undefined> {
  const cost = { requests: 1, tokens: batchTokens + routing.overheadTokens };
  const candidates = PROVIDER_ORDER.filter(
    (provider) => routing.budgets[provider] && (provider !== "groq" || batchTokens <= routing.groqMaxBatchTokens),
  );

  for (;;) {
    signal?.throwIfAborted();
    let earliest: number | undefined;
    for (const provider of candidates) {
      const result = routing.budgets[provider]!.tryReserve(cost);
      if (result.ok) return { provider, reservation: result.reservation };
      if (result.retryAt) earliest = Math.min(earliest ?? Infinity, result.retryAt.getTime());
    }
    if (earliest === undefined || earliest > deadlineAt - MIN_CALL_MS) return undefined;
    await routing.sleep(Math.max(0, earliest - routing.now()), signal);
  }
}

/**
 * Replaces the estimate with what the agent reports. A call that made no LLM request gives its
 * reservation back; one Gemini answered after Groq failed is charged to Gemini instead.
 */
export function settleCall(routing: LlmRouting, reserved: ReservedCall, llm: AgentLlmUsage | undefined): void {
  const budget = routing.budgets[reserved.provider]!;
  const used = (llm?.promptTokens ?? 0) + (llm?.completionTokens ?? 0);
  if (!llm?.provider || used === 0) {
    budget.release(reserved.reservation);
    return;
  }
  if (llm.provider === reserved.provider) {
    budget.settle(reserved.reservation, used);
    return;
  }
  budget.release(reserved.reservation);
  const answered = llm.provider === "groq" || llm.provider === "gemini" ? routing.budgets[llm.provider] : undefined;
  answered?.charge({ requests: 1, tokens: used });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
