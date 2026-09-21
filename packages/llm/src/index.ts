/**
 * @code-sentinel/llm: Groq (primary) and Gemini (secondary) review clients, the per-provider quota
 * budget, the token estimate and Gemini embeddings (`plans/large-diffs.md`, `class_llm.mmd`).
 */

export {
  InputTooLargeError,
  LlmProviderError,
  LlmQuotaError,
  LlmUnavailableError,
  type LlmErrorKind,
} from "./errors.js";
export { GeminiEmbedder, type GeminiEmbedderOptions } from "./gemini-embedder.js";
export { GEMINI_BASE_URL, GeminiProvider, type GeminiProviderOptions } from "./gemini-provider.js";
export { GROQ_BASE_URL, GroqProvider, type GroqProviderOptions } from "./groq-provider.js";
export { LlmConfigError, loadLlmLimits, type LlmLimits, type ProviderSettings } from "./limits.js";
export { createLlmClient, LlmClient, type CompleteOptions, type LlmClientOptions } from "./llm-client.js";
export {
  QuotaBudget,
  type QuotaBudgetOptions,
  type QuotaCost,
  type QuotaLimits,
  type Reservation,
  type ReserveResult,
} from "./quota-budget.js";
export { estimateTokens } from "./tokens.js";
export type {
  FetchLike,
  JsonSchema,
  LlmProvider,
  LlmProviderName,
  LlmRequest,
  LlmResponse,
  ProviderCallOptions,
  ProviderRequest,
  ProviderResponse,
} from "./types.js";
