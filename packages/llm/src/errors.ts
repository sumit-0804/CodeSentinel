import type { LlmProviderName } from "./types.js";

export type LlmErrorKind = "rate_limited" | "http" | "network" | "timed_out" | "aborted" | "invalid_response";

interface LlmProviderErrorOptions {
  provider: LlmProviderName;
  kind: LlmErrorKind;
  status?: number;
  /** From `retry-after` (Groq) or `RetryInfo.retryDelay` (Gemini) on a 429. */
  retryAfterMs?: number;
  cause?: unknown;
}

/** A provider call that did not produce a usable answer. Never carries the prompt or the key. */
export class LlmProviderError extends Error {
  readonly provider: LlmProviderName;
  readonly kind: LlmErrorKind;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(message: string, options: LlmProviderErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LlmProviderError";
    this.provider = options.provider;
    this.kind = options.kind;
    if (options.status !== undefined) this.status = options.status;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}

/** A 429, or a quota the local budget could not reserve. Maps to `llm_quota_exhausted`. */
export class LlmQuotaError extends LlmProviderError {
  constructor(message: string, options: Omit<LlmProviderErrorOptions, "kind">) {
    super(message, { ...options, kind: "rate_limited" });
    this.name = "LlmQuotaError";
  }
}

/** Thrown before any request when the prompt is over the batch budget; the file is `too_large`. */
export class InputTooLargeError extends Error {
  readonly estimatedTokens: number;
  readonly maxTokens: number;

  constructor(estimatedTokens: number, maxTokens: number) {
    super(`LLM input of ~${estimatedTokens} tokens exceeds the ${maxTokens}-token limit`);
    this.name = "InputTooLargeError";
    this.estimatedTokens = estimatedTokens;
    this.maxTokens = maxTokens;
  }
}

/** The requested provider has no API key in this environment. */
export class LlmUnavailableError extends Error {
  readonly provider: LlmProviderName;

  constructor(provider: LlmProviderName) {
    super(`LLM provider ${provider} is not configured`);
    this.name = "LlmUnavailableError";
    this.provider = provider;
  }
}
