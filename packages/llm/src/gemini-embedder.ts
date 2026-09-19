import { z } from "zod";

import { LlmProviderError, LlmQuotaError } from "./errors.js";
import { GEMINI_BASE_URL, retryDelayMs } from "./gemini-provider.js";
import { httpError, invalid, postJson } from "./http.js";
import type { QuotaBudget } from "./quota-budget.js";
import { estimateTokens } from "./tokens.js";
import type { FetchLike } from "./types.js";

export interface GeminiEmbedderOptions {
  apiKey: string;
  model: string;
  /** Sent as `outputDimensionality`; ChromaDB stores 768-dimension vectors. */
  dimensions?: number;
  /** Every request is reserved here first, so embeddings never hit a 429. */
  budget?: QuotaBudget;
  baseUrl?: string;
  fetch?: FetchLike;
}

const EmbedSchema = z.object({
  embedding: z.object({ values: z.array(z.number()) }),
  usageMetadata: z.object({ promptTokenCount: z.number().int().min(0).optional() }).optional(),
});

/**
 * Gemini embeddings for the vector database (FR-VDB-01). `gemini-embedding-2` has no batch
 * endpoint usable in a review, so each text is one `embedContent` request.
 */
export class GeminiEmbedder {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimensions: number;
  private readonly budget?: QuotaBudget;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: GeminiEmbedderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.dimensions = options.dimensions ?? 768;
    if (options.budget) this.budget = options.budget;
    this.baseUrl = (options.baseUrl ?? GEMINI_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** One vector per text, in order. Fails as a whole if any text cannot be embedded. */
  async embedMany(texts: readonly string[], options: { signal?: AbortSignal } = {}): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text, options.signal)));
  }

  private async embed(text: string, signal: AbortSignal | undefined): Promise<number[]> {
    const estimate = estimateTokens(text);
    const reserved = this.budget?.tryReserve({ requests: 1, tokens: estimate });
    if (reserved && !reserved.ok) {
      throw new LlmQuotaError("gemini embedding quota is full", {
        provider: "gemini",
        ...(reserved.retryAt ? { retryAfterMs: Math.max(0, reserved.retryAt.getTime() - Date.now()) } : {}),
      });
    }

    try {
      const { status, body } = await postJson(
        this.fetchImpl,
        "gemini",
        `${this.baseUrl}/models/${encodeURIComponent(this.model)}:embedContent`,
        { "x-goog-api-key": this.apiKey },
        { content: { parts: [{ text }] }, outputDimensionality: this.dimensions },
        signal,
      );
      if (status < 200 || status >= 300) throw httpError("gemini", status, retryDelayMs(body));

      const parsed = EmbedSchema.safeParse(body);
      if (!parsed.success) throw invalid("gemini", "unexpected embedContent shape", parsed.error);
      const { values } = parsed.data.embedding;
      if (values.length !== this.dimensions) {
        throw invalid("gemini", `embedding has ${values.length} dimensions, expected ${this.dimensions}`);
      }
      if (reserved?.ok) this.budget!.settle(reserved.reservation, parsed.data.usageMetadata?.promptTokenCount ?? estimate);
      return values;
    } catch (error) {
      // A request that failed before reaching Gemini should not keep its reservation.
      if (reserved?.ok && isTransportFailure(error)) this.budget!.release(reserved.reservation);
      throw error;
    }
  }
}

function isTransportFailure(error: unknown): boolean {
  return error instanceof LlmProviderError && (error.kind === "network" || error.kind === "aborted");
}
