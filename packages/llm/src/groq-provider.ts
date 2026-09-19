import { z } from "zod";

import { httpError, invalid, postJson } from "./http.js";
import type { FetchLike, LlmProvider, ProviderCallOptions, ProviderRequest, ProviderResponse } from "./types.js";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export interface GroqProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

const CompletionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z.object({ prompt_tokens: z.number().int().min(0), completion_tokens: z.number().int().min(0) }),
});

/** Groq's OpenAI-compatible chat completions with strict JSON-schema output (primary provider). */
export class GroqProvider implements LlmProvider {
  readonly name = "groq" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: GroqProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = (options.baseUrl ?? GROQ_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async complete(request: ProviderRequest, options: ProviderCallOptions = {}): Promise<ProviderResponse> {
    const { status, headers, body } = await postJson(
      this.fetchImpl,
      this.name,
      `${this.baseUrl}/chat/completions`,
      { Authorization: `Bearer ${this.apiKey}` },
      {
        model: this.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: request.schemaName, strict: true, schema: request.responseSchema },
        },
        max_completion_tokens: request.maxOutputTokens,
        temperature: request.temperature ?? 0,
        // gpt-oss reasoning tokens count against the 8K TPM free tier, so keep them few and unreturned.
        reasoning_effort: "low",
        include_reasoning: false,
      },
      options.signal,
    );

    if (status < 200 || status >= 300) throw httpError(this.name, status, retryAfterMs(headers.get("retry-after")));

    const parsed = CompletionSchema.safeParse(body);
    if (!parsed.success) throw invalid(this.name, "unexpected completion shape", parsed.error);
    const choice = parsed.data.choices[0]!;
    if (choice.finish_reason === "length") throw invalid(this.name, "output hit max_completion_tokens");
    if (!choice.message.content) throw invalid(this.name, "empty content");

    return {
      text: choice.message.content,
      provider: this.name,
      model: parsed.data.model ?? this.model,
      promptTokens: parsed.data.usage.prompt_tokens,
      completionTokens: parsed.data.usage.completion_tokens,
    };
  }
}

/** `retry-after` is in seconds on Groq's 429s. */
function retryAfterMs(header: string | null): number | undefined {
  const seconds = header === null ? NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : undefined;
}
