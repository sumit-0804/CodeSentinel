import { z } from "zod";

import type { QuotaLimits } from "./quota-budget.js";

export interface ProviderSettings {
  apiKey: string;
  model: string;
  limits: QuotaLimits;
}

export interface LlmLimits {
  /** Primary review provider; absent when `GROQ_API_KEY` is unset. */
  groq?: ProviderSettings;
  /** Secondary review provider; absent when `GEMINI_API_KEY` is unset. */
  gemini?: ProviderSettings;
  /** Gemini embeddings; absent without a Gemini key or any of `GEMINI_EMBED_RPM/TPM/RPD`. */
  embedding?: ProviderSettings;
  headroom: number;
  maxOutputTokens: number;
  maxFileTokens: number;
  maxBatchTokens: number;
  reviewMaxTokens: number;
  promptReserveTokens: number;
}

/** Thrown by `loadLlmLimits` with every invalid variable listed at once. */
export class LlmConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: string[]) {
    super(`Invalid LLM configuration: ${problems.join("; ")}`);
    this.name = "LlmConfigError";
    this.problems = problems;
  }
}

const blankAsUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const int = () => z.coerce.number({ invalid_type_error: "must be an integer" }).int("must be an integer").positive("must be positive");
const intOr = (fallback: number) => z.preprocess(blankAsUndefined, int().default(fallback));
const optionalInt = () => z.preprocess(blankAsUndefined, int().optional());
const stringOr = (fallback: string) => z.preprocess(blankAsUndefined, z.string().default(fallback));
const optionalString = () => z.preprocess(blankAsUndefined, z.string().optional());

const EnvSchema = z.object({
  GROQ_API_KEY: optionalString(),
  GROQ_MODEL: stringOr("openai/gpt-oss-120b"),
  GROQ_RPM: intOr(30),
  GROQ_TPM: intOr(8000),
  GROQ_RPD: intOr(1000),
  GROQ_TPD: intOr(200000),
  GEMINI_API_KEY: optionalString(),
  GEMINI_MODEL: stringOr("gemini-3.5-flash-lite"),
  GEMINI_RPM: intOr(15),
  GEMINI_TPM: intOr(250000),
  GEMINI_RPD: intOr(500),
  GEMINI_EMBEDDING_MODEL: stringOr("gemini-embedding-2"),
  GEMINI_EMBED_RPM: optionalInt(),
  GEMINI_EMBED_TPM: optionalInt(),
  GEMINI_EMBED_RPD: optionalInt(),
  LLM_QUOTA_HEADROOM: z.preprocess(
    blankAsUndefined,
    z.coerce.number({ invalid_type_error: "must be a number" }).gt(0, "must be in (0, 1]").max(1, "must be in (0, 1]").default(0.8),
  ),
  LLM_MAX_OUTPUT_TOKENS: intOr(2000),
  LLM_MAX_FILE_TOKENS: intOr(6000),
  LLM_MAX_BATCH_TOKENS: intOr(12000),
  LLM_REVIEW_MAX_TOKENS: intOr(24000),
  LLM_PROMPT_RESERVE_TOKENS: intOr(1000),
});

/**
 * Reads the LLM settings (see `plans/large-diffs.md`). A provider is enabled by its API key; limits
 * default to the free tiers and should be set to the quota page of **this environment's** key.
 */
export function loadLlmLimits(env: Record<string, string | undefined> = process.env): LlmLimits {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new LlmConfigError(parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`));
  }
  const v = parsed.data;

  const limits: LlmLimits = {
    headroom: v.LLM_QUOTA_HEADROOM,
    maxOutputTokens: v.LLM_MAX_OUTPUT_TOKENS,
    maxFileTokens: v.LLM_MAX_FILE_TOKENS,
    maxBatchTokens: v.LLM_MAX_BATCH_TOKENS,
    reviewMaxTokens: v.LLM_REVIEW_MAX_TOKENS,
    promptReserveTokens: v.LLM_PROMPT_RESERVE_TOKENS,
  };
  if (v.GROQ_API_KEY) {
    limits.groq = {
      apiKey: v.GROQ_API_KEY,
      model: v.GROQ_MODEL,
      limits: { requestsPerMinute: v.GROQ_RPM, tokensPerMinute: v.GROQ_TPM, requestsPerDay: v.GROQ_RPD, tokensPerDay: v.GROQ_TPD },
    };
  }
  if (v.GEMINI_API_KEY) {
    limits.gemini = {
      apiKey: v.GEMINI_API_KEY,
      model: v.GEMINI_MODEL,
      limits: { requestsPerMinute: v.GEMINI_RPM, tokensPerMinute: v.GEMINI_TPM, requestsPerDay: v.GEMINI_RPD },
    };
    if (v.GEMINI_EMBED_RPM && v.GEMINI_EMBED_TPM && v.GEMINI_EMBED_RPD) {
      limits.embedding = {
        apiKey: v.GEMINI_API_KEY,
        model: v.GEMINI_EMBEDDING_MODEL,
        limits: { requestsPerMinute: v.GEMINI_EMBED_RPM, tokensPerMinute: v.GEMINI_EMBED_TPM, requestsPerDay: v.GEMINI_EMBED_RPD },
      };
    }
  }
  return limits;
}
