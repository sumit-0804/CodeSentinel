import { describe, expect, it, vi } from "vitest";

import { CloudflareProvider } from "./cloudflare-provider.js";
import { LlmProviderError, LlmQuotaError } from "./errors.js";
import { GeminiProvider } from "./gemini-provider.js";
import { GroqProvider } from "./groq-provider.js";
import type { FetchLike, ProviderRequest } from "./types.js";

const REQUEST: ProviderRequest = {
  systemPrompt: "You review code.",
  prompt: "diff here",
  schemaName: "findings",
  responseSchema: { type: "object", properties: { findings: { type: "array" } }, required: ["findings"], additionalProperties: false },
  maxOutputTokens: 500,
};

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn<FetchLike>(async () => new Response(JSON.stringify(body), { status, headers }));
}

async function caught(promise: Promise<unknown>): Promise<LlmProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LlmProviderError) return error;
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("GroqProvider", () => {
  const ok = {
    model: "openai/gpt-oss-120b",
    choices: [{ message: { content: '{"findings":[]}' }, finish_reason: "stop" }],
    usage: { prompt_tokens: 120, completion_tokens: 30 },
  };

  it("sends a strict json_schema chat completion and returns text and usage", async () => {
    const fetchImpl = respond(200, ok);
    const groq = new GroqProvider({ apiKey: "gk", model: "openai/gpt-oss-120b", fetch: fetchImpl });

    const result = await groq.complete(REQUEST);

    expect(result).toEqual({ text: '{"findings":[]}', provider: "groq", model: "openai/gpt-oss-120b", promptTokens: 120, completionTokens: 30 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer gk");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: "You review code." },
        { role: "user", content: "diff here" },
      ],
      response_format: { type: "json_schema", json_schema: { name: "findings", strict: true, schema: REQUEST.responseSchema } },
      max_completion_tokens: 500,
      temperature: 0,
      reasoning_effort: "low",
      include_reasoning: false,
    });
  });

  it("turns a 429 into LlmQuotaError with retry-after in ms", async () => {
    const groq = new GroqProvider({ apiKey: "gk", model: "m", fetch: respond(429, { error: { message: "slow down" } }, { "retry-after": "7" }) });

    const error = await caught(groq.complete(REQUEST));

    expect(error).toBeInstanceOf(LlmQuotaError);
    expect(error).toMatchObject({ provider: "groq", kind: "rate_limited", status: 429, retryAfterMs: 7000 });
  });

  it("rejects a truncated answer and a 5xx", async () => {
    const truncated = new GroqProvider({
      apiKey: "gk",
      model: "m",
      fetch: respond(200, { ...ok, choices: [{ message: { content: '{"find' }, finish_reason: "length" }] }),
    });
    const down = new GroqProvider({ apiKey: "gk", model: "m", fetch: respond(503, { error: {} }) });

    expect(await caught(truncated.complete(REQUEST))).toMatchObject({ kind: "invalid_response" });
    expect(await caught(down.complete(REQUEST))).toMatchObject({ kind: "http", status: 503 });
  });

  it("maps a network failure and a timeout", async () => {
    const refused = new GroqProvider({ apiKey: "gk", model: "m", fetch: async () => Promise.reject(new TypeError("fetch failed")) });
    const slow = new GroqProvider({
      apiKey: "gk",
      model: "m",
      fetch: async () => Promise.reject(new DOMException("timed out", "TimeoutError")),
    });

    expect(await caught(refused.complete(REQUEST))).toMatchObject({ kind: "network" });
    expect(await caught(slow.complete(REQUEST))).toMatchObject({ kind: "timed_out" });
  });
});

describe("CloudflareProvider", () => {
  // The shape Workers AI answered with on 16-Nov, extra fields included.
  const ok = {
    model: "@cf/openai/gpt-oss-120b",
    choices: [{ index: 0, message: { role: "assistant", content: '{"findings":[]}', reasoning_content: "thinking" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 92, completion_tokens: 112, total_tokens: 204, neurons: 10.5 },
  };

  it("calls the account's OpenAI-compatible endpoint with the token and returns text and usage", async () => {
    const fetchImpl = respond(200, ok);
    const cloudflare = new CloudflareProvider({ apiToken: "ct", accountId: "acc 1", model: "@cf/openai/gpt-oss-120b", fetch: fetchImpl });

    const result = await cloudflare.complete(REQUEST);

    expect(result).toEqual({ text: '{"findings":[]}', provider: "cloudflare", model: "@cf/openai/gpt-oss-120b", promptTokens: 92, completionTokens: 112 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc%201/ai/v1/chat/completions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer ct");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "@cf/openai/gpt-oss-120b",
      response_format: { type: "json_schema", json_schema: { name: "findings", strict: true } },
      max_completion_tokens: 500,
    });
    expect(body).not.toHaveProperty("include_reasoning");
  });

  it("names itself in errors", async () => {
    const down = new CloudflareProvider({ apiToken: "ct", accountId: "acc", model: "m", fetch: respond(500, { errors: [] }) });
    const full = new CloudflareProvider({ apiToken: "ct", accountId: "acc", model: "m", fetch: respond(429, { errors: [] }) });

    expect(await caught(down.complete(REQUEST))).toMatchObject({ provider: "cloudflare", kind: "http", status: 500 });
    expect(await caught(full.complete(REQUEST))).toBeInstanceOf(LlmQuotaError);
  });
});

describe("GeminiProvider", () => {
  const ok = {
    candidates: [{ content: { parts: [{ text: '{"findings":' }, { text: "[]}" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40, thoughtsTokenCount: 10 },
    modelVersion: "gemini-3.5-flash-lite",
  };

  it("sends responseJsonSchema and counts thinking tokens as output", async () => {
    const fetchImpl = respond(200, ok);
    const gemini = new GeminiProvider({ apiKey: "ak", model: "gemini-3.5-flash-lite", fetch: fetchImpl });

    const result = await gemini.complete(REQUEST);

    expect(result).toEqual({ text: '{"findings":[]}', provider: "gemini", model: "gemini-3.5-flash-lite", promptTokens: 200, completionTokens: 50 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("ak");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      systemInstruction: { parts: [{ text: "You review code." }] },
      contents: [{ role: "user", parts: [{ text: "diff here" }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: REQUEST.responseSchema, maxOutputTokens: 500 },
    });
  });

  it("reads RetryInfo.retryDelay from a 429", async () => {
    const body = { error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "1.5s" }] } };
    const gemini = new GeminiProvider({ apiKey: "ak", model: "m", fetch: respond(429, body) });

    expect(await caught(gemini.complete(REQUEST))).toMatchObject({ kind: "rate_limited", retryAfterMs: 1500 });
  });

  it("rejects a blocked prompt and a MAX_TOKENS finish", async () => {
    const blocked = new GeminiProvider({ apiKey: "ak", model: "m", fetch: respond(200, { promptFeedback: { blockReason: "SAFETY" } }) });
    const cut = new GeminiProvider({
      apiKey: "ak",
      model: "m",
      fetch: respond(200, { ...ok, candidates: [{ content: { parts: [{ text: "{" }] }, finishReason: "MAX_TOKENS" }] }),
    });

    expect((await caught(blocked.complete(REQUEST))).message).toMatch(/blocked \(SAFETY\)/);
    expect(await caught(cut.complete(REQUEST))).toMatchObject({ kind: "invalid_response" });
  });
});
