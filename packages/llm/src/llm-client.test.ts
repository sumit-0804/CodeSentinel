import { describe, expect, it, vi } from "vitest";

import { InputTooLargeError, LlmProviderError, LlmQuotaError, LlmUnavailableError } from "./errors.js";
import { LlmClient } from "./llm-client.js";
import type { LlmProvider, LlmProviderName, LlmRequest, ProviderResponse } from "./types.js";

const REQUEST: LlmRequest = { systemPrompt: "sys", prompt: "diff", schemaName: "s", responseSchema: {} };

function provider(name: LlmProviderName, result: ProviderResponse | Error) {
  return {
    name,
    model: `${name}-model`,
    complete: vi.fn<LlmProvider["complete"]>(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

const answer = (name: LlmProviderName): ProviderResponse => ({ text: "{}", provider: name, model: `${name}-model`, promptTokens: 5, completionTokens: 2 });

function client(groq: ReturnType<typeof provider> | undefined, gemini: ReturnType<typeof provider> | undefined, now = () => 0) {
  return new LlmClient({
    ...(groq ? { groq } : {}),
    ...(gemini ? { gemini } : {}),
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

  it("refuses an oversized prompt before any call, and an unconfigured provider", async () => {
    const groq = provider("groq", answer("groq"));

    await expect(client(groq, undefined).complete({ ...REQUEST, prompt: "x".repeat(400) }, { provider: "groq" })).rejects.toBeInstanceOf(
      InputTooLargeError,
    );
    await expect(client(groq, undefined).complete(REQUEST, { provider: "gemini" })).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(groq.complete).not.toHaveBeenCalled();
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
