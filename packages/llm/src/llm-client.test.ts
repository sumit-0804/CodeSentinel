import { describe, expect, it, vi } from "vitest";

import { InputTooLargeError, LlmProviderError, LlmQuotaError, LlmUnavailableError } from "./errors.js";
import { loadLlmLimits } from "./limits.js";
import { createLlmClient, LlmClient } from "./llm-client.js";
import type { LlmBackendName, LlmProvider, LlmRequest, ProviderResponse } from "./types.js";

const REQUEST: LlmRequest = { systemPrompt: "sys", prompt: "diff", schemaName: "s", responseSchema: {} };

function provider(name: LlmBackendName, result: ProviderResponse | Error) {
  return {
    name,
    model: `${name}-model`,
    complete: vi.fn<LlmProvider["complete"]>(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

const answer = (name: LlmBackendName): ProviderResponse => ({ text: "{}", provider: name, model: `${name}-model`, promptTokens: 5, completionTokens: 2 });

function client(
  groq: ReturnType<typeof provider> | undefined,
  gemini: ReturnType<typeof provider> | undefined,
  now = () => 0,
  cloudflare?: ReturnType<typeof provider>,
) {
  return new LlmClient({
    ...(groq ? { groq } : {}),
    ...(gemini ? { gemini } : {}),
    ...(cloudflare ? { cloudflare } : {}),
    maxInputTokens: 100,
    maxOutputTokens: 300,
    now,
  });
}

describe("LlmClient", () => {
  it("calls the assigned provider with the default output cap and reports fallbackDepth 0", async () => {
    const groq = provider("groq", answer("groq"));
    const gemini = provider("gemini", answer("gemini"));

    const result = await client(groq, gemini).complete(REQUEST, { provider: "groq" });

    expect(result).toEqual({ ...answer("groq"), fallbackDepth: 0 });
    expect(groq.complete.mock.calls[0]?.[0]).toMatchObject({ maxOutputTokens: 300 });
    expect(gemini.complete).not.toHaveBeenCalled();
  });

  it.each([
    ["a 429", new LlmQuotaError("full", { provider: "groq", status: 429 })],
    ["a 5xx", new LlmProviderError("down", { provider: "groq", kind: "http", status: 502 })],
    ["a network error", new LlmProviderError("reset", { provider: "groq", kind: "network" })],
    ["a timeout", new LlmProviderError("slow", { provider: "groq", kind: "timed_out" })],
  ])("retries on Gemini after %s from Groq with fallbackDepth 1", async (_label, error) => {
    const gemini = provider("gemini", answer("gemini"));

    const result = await client(provider("groq", error), gemini).complete(REQUEST, { provider: "groq" });

    expect(result).toEqual({ ...answer("gemini"), fallbackDepth: 1 });
  });

  it("does not fall back on a 4xx, a bad answer, a Gemini failure, or without time left", async () => {
    const badRequest = new LlmProviderError("bad", { provider: "groq", kind: "http", status: 400 });
    const badAnswer = new LlmProviderError("junk", { provider: "groq", kind: "invalid_response" });
    const geminiDown = new LlmProviderError("down", { provider: "gemini", kind: "http", status: 503 });
    const quota = new LlmQuotaError("full", { provider: "groq" });
    const gemini = () => provider("gemini", answer("gemini"));

    await expect(client(provider("groq", badRequest), gemini()).complete(REQUEST, { provider: "groq" })).rejects.toBe(badRequest);
    await expect(client(provider("groq", badAnswer), gemini()).complete(REQUEST, { provider: "groq" })).rejects.toBe(badAnswer);
    await expect(client(undefined, provider("gemini", geminiDown)).complete(REQUEST, { provider: "gemini" })).rejects.toBe(geminiDown);
    await expect(
      client(provider("groq", quota), gemini(), () => 9_000).complete(REQUEST, { provider: "groq", deadlineAt: 10_000 }),
    ).rejects.toBe(quota);
  });

  // 16-Nov: Gemini answered 503 all afternoon and large pull requests lost three agents.
  it("falls back to Cloudflare when Gemini is down, as the assigned provider or after Groq", async () => {
    const geminiDown = () => provider("gemini", new LlmProviderError("down", { provider: "gemini", kind: "http", status: 503 }));
    const groqFull = provider("groq", new LlmQuotaError("full", { provider: "groq", status: 429 }));
    const cloudflare = provider("cloudflare", answer("cloudflare"));

    const assigned = await client(undefined, geminiDown(), undefined, cloudflare).complete(REQUEST, { provider: "gemini" });
    const afterGroq = await client(groqFull, geminiDown(), undefined, cloudflare).complete(REQUEST, { provider: "groq" });

    expect(assigned).toEqual({ ...answer("cloudflare"), fallbackDepth: 1 });
    expect(afterGroq).toEqual({ ...answer("cloudflare"), fallbackDepth: 2 });
  });

  it("leaves Cloudflare alone when a provider answers, on a 4xx, and without time left", async () => {
    const cloudflare = provider("cloudflare", answer("cloudflare"));
    const badRequest = new LlmProviderError("bad", { provider: "gemini", kind: "http", status: 400 });
    const down = new LlmProviderError("down", { provider: "gemini", kind: "http", status: 503 });

    await client(undefined, provider("gemini", answer("gemini")), undefined, cloudflare).complete(REQUEST, { provider: "gemini" });
    await expect(client(undefined, provider("gemini", badRequest), undefined, cloudflare).complete(REQUEST, { provider: "gemini" })).rejects.toBe(badRequest);
    await expect(
      client(undefined, provider("gemini", down), () => 9_000, cloudflare).complete(REQUEST, { provider: "gemini", deadlineAt: 10_000 }),
    ).rejects.toBe(down);

    expect(cloudflare.complete).not.toHaveBeenCalled();
  });

  it("reports the last failure when every provider is down", async () => {
    const cloudflareDown = new LlmProviderError("down", { provider: "cloudflare", kind: "http", status: 500 });
    const gemini = provider("gemini", new LlmProviderError("down", { provider: "gemini", kind: "http", status: 503 }));

    await expect(client(undefined, gemini, undefined, provider("cloudflare", cloudflareDown)).complete(REQUEST, { provider: "gemini" })).rejects.toBe(cloudflareDown);
  });

  it("refuses an oversized prompt before any call, and an unconfigured provider", async () => {
    const groq = provider("groq", answer("groq"));

    await expect(client(groq, undefined).complete({ ...REQUEST, prompt: "x".repeat(400) }, { provider: "groq" })).rejects.toBeInstanceOf(
      InputTooLargeError,
    );
    await expect(client(groq, undefined).complete(REQUEST, { provider: "gemini" })).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(groq.complete).not.toHaveBeenCalled();
  });

  it("cuts a slow Groq call at its cap but lets Gemini use the time left before the deadline", async () => {
    const hangs: LlmProvider = {
      name: "groq",
      model: "g",
      complete: (_request, options) =>
        new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new LlmProviderError("slow", { provider: "groq", kind: "timed_out" })))),
    };
    const slowGemini: LlmProvider = {
      name: "gemini",
      model: "m",
      complete: async (_request, options) => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        if (options?.signal?.aborted) throw new Error("gemini was cut at Groq's cap");
        return answer("gemini");
      },
    };
    const llm = new LlmClient({ groq: hangs, gemini: slowGemini, maxInputTokens: 100, maxOutputTokens: 10, groqTimeoutMs: 20 });

    const result = await llm.complete(REQUEST, { provider: "groq", deadlineAt: Date.now() + 5_000 });

    expect(result).toMatchObject({ provider: "gemini", fallbackDepth: 1 });
  });

  it("passes an abort signal that fires with the caller's", async () => {
    const groq = provider("groq", answer("groq"));
    const controller = new AbortController();

    await client(groq, undefined).complete(REQUEST, { provider: "groq", signal: controller.signal });
    const signal = groq.complete.mock.calls[0]?.[1]?.signal;
    controller.abort();

    expect(signal?.aborted).toBe(true);
  });
});

describe("createLlmClient", () => {
  it("wires the configured providers and is undefined without keys", () => {
    const client = createLlmClient(loadLlmLimits({ GROQ_API_KEY: "gk" }));

    expect(client?.has("groq")).toBe(true);
    expect(client?.has("gemini")).toBe(false);
    expect(client?.has("cloudflare")).toBe(false);
    expect(createLlmClient(loadLlmLimits({ GROQ_API_KEY: "gk", CLOUDFLARE_API_TOKEN: "ct", CLOUDFLARE_ACCOUNT_ID: "acc" }))?.has("cloudflare")).toBe(true);
    expect(createLlmClient(loadLlmLimits({}))).toBeUndefined();
  });
});
