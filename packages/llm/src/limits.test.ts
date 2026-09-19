import { describe, expect, it } from "vitest";

import { LlmConfigError, loadLlmLimits } from "./limits.js";
import { estimateTokens } from "./tokens.js";

describe("loadLlmLimits", () => {
  it("enables no provider without keys and applies the plan defaults", () => {
    expect(loadLlmLimits({})).toEqual({
      headroom: 0.8,
      maxOutputTokens: 2000,
      maxFileTokens: 6000,
      maxBatchTokens: 12000,
      reviewMaxTokens: 24000,
      promptReserveTokens: 1000,
    });
  });

  it("enables Groq and Gemini by key with free-tier defaults, and embeddings only with their limits", () => {
    const limits = loadLlmLimits({ GROQ_API_KEY: "gk", GEMINI_API_KEY: "ak", GROQ_TPM: "" });

    expect(limits.groq).toEqual({
      apiKey: "gk",
      model: "openai/gpt-oss-120b",
      limits: { requestsPerMinute: 30, tokensPerMinute: 8000, requestsPerDay: 1000, tokensPerDay: 200000 },
    });
    expect(limits.gemini).toEqual({
      apiKey: "ak",
      model: "gemini-3.5-flash-lite",
      limits: { requestsPerMinute: 15, tokensPerMinute: 250000, requestsPerDay: 500 },
    });
    expect(limits.embedding).toBeUndefined();

    const withEmbed = loadLlmLimits({ GEMINI_API_KEY: "ak", GEMINI_EMBED_RPM: "100", GEMINI_EMBED_TPM: "30000", GEMINI_EMBED_RPD: "1000" });
    expect(withEmbed.embedding).toMatchObject({ model: "gemini-embedding-2", limits: { requestsPerMinute: 100 } });
  });

  it("reports every invalid variable at once", () => {
    let error: unknown;
    try {
      loadLlmLimits({ GROQ_TPM: "lots", LLM_QUOTA_HEADROOM: "1.5" });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(LlmConfigError);
    expect((error as LlmConfigError).problems).toEqual(["GROQ_TPM must be an integer", "LLM_QUOTA_HEADROOM must be in (0, 1]"]);
  });
});

describe("estimateTokens", () => {
  it("counts about three UTF-8 bytes per token, rounding up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(2);
    expect(estimateTokens("é")).toBe(1);
  });
});
