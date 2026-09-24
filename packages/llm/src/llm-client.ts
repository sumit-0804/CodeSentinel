import { InputTooLargeError, LlmProviderError, LlmUnavailableError } from "./errors.js";
import { GeminiProvider } from "./gemini-provider.js";
import { GroqProvider } from "./groq-provider.js";
import type { LlmLimits } from "./limits.js";
import { estimateTokens } from "./tokens.js";
import type { FetchLike, LlmProvider, LlmProviderName, LlmRequest, LlmResponse } from "./types.js";

export interface LlmClientOptions {
  groq?: LlmProvider;
  gemini?: LlmProvider;
  /** Largest prompt (system + user) accepted, in estimated tokens; bigger inputs never reach a provider. */
  maxInputTokens: number;
  /** Default output cap when a request sets none (`LLM_MAX_OUTPUT_TOKENS`). */
  maxOutputTokens: number;
  /** Cap on a Groq call, so a slow Groq leaves time to fall back to Gemini. */
  groqTimeoutMs?: number;
  /** Cap on a Gemini call when the caller gives no deadline; with one, Gemini may use all of it. */
  maxCallMs?: number;
  now?: () => number;
}

export interface CompleteOptions {
  /** The provider whose quota the orchestrator reserved. */
  provider: LlmProviderName;
  signal?: AbortSignal;
  /** Epoch ms after which the answer is useless (the agent's `deadlineMs`). */
  deadlineAt?: number;
}

const DEFAULT_GROQ_TIMEOUT_MS = 15_000;
/** Gemini's free tier took 15–22 s per call on 27-Sep, so it is not held to Groq's cap. */
const DEFAULT_MAX_CALL_MS = 60_000;
/** A Gemini retry is only attempted with at least this much time left. */
const MIN_FALLBACK_MS = 2_000;

/**
 * `LlmClient` from `class_llm.mmd`: calls the assigned provider, and when that is Groq and the call
 * fails on quota, a 5xx, the network or a timeout, retries once on Gemini (`fallbackDepth: 1`).
 */
export class LlmClient {
  private readonly providers: Partial<Record<LlmProviderName, LlmProvider>>;
  private readonly maxInputTokens: number;
  private readonly maxOutputTokens: number;
  private readonly groqTimeoutMs: number;
  private readonly maxCallMs: number;
  private readonly now: () => number;

  constructor(options: LlmClientOptions) {
    this.providers = {
      ...(options.groq ? { groq: options.groq } : {}),
      ...(options.gemini ? { gemini: options.gemini } : {}),
    };
    this.maxInputTokens = options.maxInputTokens;
    this.maxOutputTokens = options.maxOutputTokens;
    this.groqTimeoutMs = options.groqTimeoutMs ?? DEFAULT_GROQ_TIMEOUT_MS;
    this.maxCallMs = options.maxCallMs ?? DEFAULT_MAX_CALL_MS;
    this.now = options.now ?? Date.now;
  }

  has(provider: LlmProviderName): boolean {
    return this.providers[provider] !== undefined;
  }

  async complete(request: LlmRequest, options: CompleteOptions): Promise<LlmResponse> {
    const inputTokens = estimateTokens(request.systemPrompt) + estimateTokens(request.prompt);
    if (inputTokens > this.maxInputTokens) throw new InputTooLargeError(inputTokens, this.maxInputTokens);

    const primary = this.providers[options.provider];
    if (!primary) throw new LlmUnavailableError(options.provider);
    const resolved = { ...request, maxOutputTokens: request.maxOutputTokens ?? this.maxOutputTokens };

    try {
      return { ...(await primary.complete(resolved, { signal: this.callSignal(options, primary.name) })), fallbackDepth: 0 };
    } catch (error) {
      const fallback = this.providers.gemini;
      if (options.provider !== "groq" || !fallback || !shouldFallBack(error) || !this.hasTimeForFallback(options)) {
        throw error;
      }
      return { ...(await fallback.complete(resolved, { signal: this.callSignal(options, fallback.name) })), fallbackDepth: 1 };
    }
  }

  private callSignal(options: CompleteOptions, provider: LlmProviderName): AbortSignal {
    const remaining = options.deadlineAt === undefined ? this.maxCallMs : options.deadlineAt - this.now();
    const cap = provider === "groq" ? Math.min(this.groqTimeoutMs, remaining) : remaining;
    const timeout = AbortSignal.timeout(Math.max(1, cap));
    return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  }

  private hasTimeForFallback(options: CompleteOptions): boolean {
    if (options.signal?.aborted) return false;
    return options.deadlineAt === undefined || options.deadlineAt - this.now() >= MIN_FALLBACK_MS;
  }
}

function shouldFallBack(error: unknown): boolean {
  if (!(error instanceof LlmProviderError)) return false;
  switch (error.kind) {
    case "rate_limited":
    case "network":
    case "timed_out":
      return true;
    case "http":
      return (error.status ?? 0) >= 500;
    default:
      return false;
  }
}

/**
 * The client an agent uses, built from `loadLlmLimits()`; undefined when no provider has a key.
 * A call carries at most one batch plus the system prompt.
 */
export function createLlmClient(limits: LlmLimits, options: { fetch?: FetchLike } = {}): LlmClient | undefined {
  if (!limits.groq && !limits.gemini) return undefined;
  const fetchOption = options.fetch ? { fetch: options.fetch } : {};
  return new LlmClient({
    ...(limits.groq ? { groq: new GroqProvider({ ...limits.groq, ...fetchOption }) } : {}),
    ...(limits.gemini ? { gemini: new GeminiProvider({ ...limits.gemini, ...fetchOption }) } : {}),
    maxInputTokens: limits.maxBatchTokens + limits.promptReserveTokens,
    maxOutputTokens: limits.maxOutputTokens,
  });
}
