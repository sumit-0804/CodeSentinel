import { chatCompletion } from "./openai-chat.js";
import type { FetchLike, LlmProvider, ProviderCallOptions, ProviderRequest, ProviderResponse } from "./types.js";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export interface GroqProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

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

  complete(request: ProviderRequest, options: ProviderCallOptions = {}): Promise<ProviderResponse> {
    return chatCompletion({
      fetch: this.fetchImpl,
      provider: this.name,
      url: `${this.baseUrl}/chat/completions`,
      apiKey: this.apiKey,
      model: this.model,
      request,
      // Reasoning text is never used, so Groq is told not to return it.
      extra: { include_reasoning: false },
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }
}
