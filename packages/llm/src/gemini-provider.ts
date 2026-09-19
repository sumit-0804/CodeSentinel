import { z } from "zod";

import { httpError, invalid, postJson } from "./http.js";
import type { FetchLike, LlmProvider, ProviderCallOptions, ProviderRequest, ProviderResponse } from "./types.js";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

const GenerateSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })).optional() }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().int().min(0).optional(),
      candidatesTokenCount: z.number().int().min(0).optional(),
      thoughtsTokenCount: z.number().int().min(0).optional(),
    })
    .optional(),
  modelVersion: z.string().optional(),
});

const ErrorSchema = z.object({
  error: z.object({ details: z.array(z.record(z.unknown())).optional() }).optional(),
});

/** Gemini `generateContent` with `responseJsonSchema` output (secondary provider). */
export class GeminiProvider implements LlmProvider {
  readonly name = "gemini" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: GeminiProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = (options.baseUrl ?? GEMINI_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async complete(request: ProviderRequest, options: ProviderCallOptions = {}): Promise<ProviderResponse> {
    const { status, body } = await postJson(
      this.fetchImpl,
      this.name,
      `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`,
      { "x-goog-api-key": this.apiKey },
      {
        systemInstruction: { parts: [{ text: request.systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: request.responseSchema,
          maxOutputTokens: request.maxOutputTokens,
          temperature: request.temperature ?? 0,
        },
      },
      options.signal,
    );

    if (status < 200 || status >= 300) throw httpError(this.name, status, retryDelayMs(body));

    const parsed = GenerateSchema.safeParse(body);
    if (!parsed.success) throw invalid(this.name, "unexpected generateContent shape", parsed.error);
    const { candidates, promptFeedback, usageMetadata } = parsed.data;
    if (promptFeedback?.blockReason) throw invalid(this.name, `prompt blocked (${promptFeedback.blockReason})`);
    const candidate = candidates?.[0];
    if (!candidate) throw invalid(this.name, "no candidates");
    if (candidate.finishReason && candidate.finishReason !== "STOP") {
      throw invalid(this.name, `finishReason ${candidate.finishReason}`);
    }
    const text = (candidate.content?.parts ?? []).map((part) => part.text ?? "").join("");
    if (!text) throw invalid(this.name, "empty content");

    return {
      text,
      provider: this.name,
      model: parsed.data.modelVersion ?? this.model,
      promptTokens: usageMetadata?.promptTokenCount ?? 0,
      // Thinking tokens are billed as output and count against TPM.
      completionTokens: (usageMetadata?.candidatesTokenCount ?? 0) + (usageMetadata?.thoughtsTokenCount ?? 0),
    };
  }
}

/** `RetryInfo.retryDelay` ("12s" or "1.5s") from a 429's `error.details`. */
export function retryDelayMs(body: unknown): number | undefined {
  const parsed = ErrorSchema.safeParse(body);
  if (!parsed.success) return undefined;
  for (const detail of parsed.data.error?.details ?? []) {
    const delay = detail.retryDelay;
    if (typeof delay !== "string") continue;
    const match = /^(\d+(?:\.\d+)?)s$/.exec(delay);
    if (match) return Math.ceil(Number(match[1]) * 1000);
  }
  return undefined;
}
