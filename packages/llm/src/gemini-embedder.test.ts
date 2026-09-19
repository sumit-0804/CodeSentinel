import { describe, expect, it, vi } from "vitest";

import { LlmQuotaError } from "./errors.js";
import { GeminiEmbedder } from "./gemini-embedder.js";
import { QuotaBudget } from "./quota-budget.js";
import type { FetchLike } from "./types.js";

const vector = (n: number) => Array.from({ length: n }, (_, i) => i / n);

function embedFetch(values = vector(768)) {
  return vi.fn<FetchLike>(
    async () => new Response(JSON.stringify({ embedding: { values }, usageMetadata: { promptTokenCount: 4 } }), { status: 200 }),
  );
}

describe("GeminiEmbedder", () => {
  it("sends one embedContent per text with outputDimensionality and keeps order", async () => {
    const fetchImpl = embedFetch();
    const embedder = new GeminiEmbedder({ apiKey: "ak", model: "gemini-embedding-2", fetch: fetchImpl });

    const vectors = await embedder.embedMany(["sql injection", "hardcoded secret"]);

    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(768);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent");
    expect(JSON.parse(String(init?.body))).toEqual({ content: { parts: [{ text: "sql injection" }] }, outputDimensionality: 768 });
  });

  it("rejects a vector with the wrong dimension count", async () => {
    const embedder = new GeminiEmbedder({ apiKey: "ak", model: "m", fetch: embedFetch(vector(3072)) });

    await expect(embedder.embedMany(["x"])).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("reserves each request on its budget and refuses when the budget is full", async () => {
    const budget = new QuotaBudget({ requestsPerMinute: 1, tokensPerMinute: 1000, requestsPerDay: 100 }, { headroom: 1 });
    const fetchImpl = embedFetch();
    const embedder = new GeminiEmbedder({ apiKey: "ak", model: "m", budget, fetch: fetchImpl });

    await embedder.embedMany(["first"]);

    await expect(embedder.embedMany(["second"])).rejects.toBeInstanceOf(LlmQuotaError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
