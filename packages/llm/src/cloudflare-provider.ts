import { chatCompletion } from "./openai-chat.js";
import type { FetchLike, LlmProvider, ProviderCallOptions, ProviderRequest, ProviderResponse } from "./types.js";

export const CLOUDFLARE_BASE_URL = "https://api.cloudflare.com/client/v4";

export interface CloudflareProviderOptions {
  apiToken: string;
  accountId: string;
  model: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

/** Cloudflare Workers AI's OpenAI-compatible chat completions; only ever the last fallback. */
export class CloudflareProvider implements LlmProvider {
  readonly name = "cloudflare" as const;
  readonly model: string;
  private readonly apiToken: string;
  private readonly url: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: CloudflareProviderOptions) {
    this.apiToken = options.apiToken;
    this.model = options.model;
    const base = (options.baseUrl ?? CLOUDFLARE_BASE_URL).replace(/\/+$/, "");
    this.url = `${base}/accounts/${encodeURIComponent(options.accountId)}/ai/v1/chat/completions`;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  complete(request: ProviderRequest, options: ProviderCallOptions = {}): Promise<ProviderResponse> {
    return chatCompletion({
      fetch: this.fetchImpl,
      provider: this.name,
      url: this.url,
      apiKey: this.apiToken,
      model: this.model,
      request,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }
}
