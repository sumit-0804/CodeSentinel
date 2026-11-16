import { z } from "zod";

import { httpError, invalid, postJson } from "./http.js";
import type { FetchLike, LlmBackendName, ProviderRequest, ProviderResponse } from "./types.js";

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

export interface ChatCompletionCall {
  fetch: FetchLike;
  provider: LlmBackendName;
  /** The full `/chat/completions` URL. */
  url: string;
  apiKey: string;
  model: string;
  request: ProviderRequest;
  /** Provider-specific body fields, e.g. Groq's `include_reasoning`. */
  extra?: Record<string, unknown>;
  signal?: AbortSignal;
}

/** One OpenAI-compatible chat completion with strict JSON-schema output (Groq and Cloudflare Workers AI). */
export async function chatCompletion(call: ChatCompletionCall): Promise<ProviderResponse> {
  const { provider, request } = call;
  const { status, headers, body } = await postJson(
    call.fetch,
    provider,
    call.url,
    { Authorization: `Bearer ${call.apiKey}` },
    {
      model: call.model,
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
      // gpt-oss reasoning tokens count against the quota, so keep them few.
      reasoning_effort: "low",
      ...call.extra,
    },
    call.signal,
  );

  if (status < 200 || status >= 300) throw httpError(provider, status, retryAfterMs(headers.get("retry-after")));

  const parsed = CompletionSchema.safeParse(body);
  if (!parsed.success) throw invalid(provider, "unexpected completion shape", parsed.error);
  const choice = parsed.data.choices[0]!;
  if (choice.finish_reason === "length") throw invalid(provider, "output hit max_completion_tokens");
  if (!choice.message.content) throw invalid(provider, "empty content");

  return {
    text: choice.message.content,
    provider,
    model: parsed.data.model ?? call.model,
    promptTokens: parsed.data.usage.prompt_tokens,
    completionTokens: parsed.data.usage.completion_tokens,
  };
}

/** `retry-after` is in seconds on a 429. */
function retryAfterMs(header: string | null): number | undefined {
  const seconds = header === null ? NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : undefined;
}
