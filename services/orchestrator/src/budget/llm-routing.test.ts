import { describe, expect, it, vi } from "vitest";

import { QuotaBudget } from "@code-sentinel/llm";
import { createLlmRouting, reserveBatch, settleCall, type LlmRouting } from "./llm-routing.js";

const T0 = Date.parse("2026-09-27T10:00:00.000Z");

/** Real budgets on a fake clock; `sleep` just advances the clock. */
function routing({ groq = true, gemini = true } = {}) {
  let now = T0;
  const clock = () => new Date(now);
  const r: LlmRouting = {
    budgets: {
      ...(groq ? { groq: new QuotaBudget({ requestsPerMinute: 30, tokensPerMinute: 8000, requestsPerDay: 1000, tokensPerDay: 200000 }, { headroom: 0.8, now: clock }) } : {}),
      ...(gemini ? { gemini: new QuotaBudget({ requestsPerMinute: 15, tokensPerMinute: 250000, requestsPerDay: 500 }, { headroom: 0.8, now: clock }) } : {}),
    },
    plan: { maxFileTokens: 6000, maxBatchTokens: 12000, reviewMaxTokens: 24000 },
    overheadTokens: 3000,
    groqMaxBatchTokens: 3400,
    llmAgentTimeoutMs: 45000,
    now: () => now,
    sleep: vi.fn(async (ms: number) => {
      now += ms;
    }),
  };
  return r;
}

describe("createLlmRouting", () => {
  it("builds a budget per configured provider and derives Groq's per-call diff cap", () => {
    const limits = {
      groq: { apiKey: "g", model: "m", limits: { requestsPerMinute: 30, tokensPerMinute: 8000, requestsPerDay: 1000, tokensPerDay: 200000 } },
      headroom: 0.8,
      maxOutputTokens: 2000,
      maxFileTokens: 6000,
      maxBatchTokens: 12000,
      reviewMaxTokens: 24000,
      promptReserveTokens: 1000,
    };

    const r = createLlmRouting(limits, 45000);

    expect(Object.keys(r!.budgets)).toEqual(["groq"]);
    expect(r!.groqMaxBatchTokens).toBe(3400);
    expect(createLlmRouting({ ...limits, groq: undefined }, 45000)).toBeUndefined();
  });
});

describe("reserveBatch", () => {
  it("uses Groq while its quota has room, then Gemini", async () => {
    const r = routing();

    expect((await reserveBatch(r, 3000, T0 + 45000))?.provider).toBe("groq");
    expect((await reserveBatch(r, 3000, T0 + 45000))?.provider).toBe("gemini");
  });

  it("sends a batch too big for one Groq call straight to Gemini", async () => {
    expect((await reserveBatch(routing(), 5000, T0 + 45000))?.provider).toBe("gemini");
  });

  it("waits for Groq to free up when Gemini is not configured, within the deadline", async () => {
    const r = routing({ gemini: false });
    await reserveBatch(r, 3000, T0 + 120000);

    const second = await reserveBatch(r, 3000, T0 + 120000);

    expect(second?.provider).toBe("groq");
    expect(r.sleep).toHaveBeenCalledWith(60001, undefined);
  });

  it("gives up when nothing frees up before the deadline, or the batch can never fit", async () => {
    const r = routing({ gemini: false });
    await reserveBatch(r, 3000, T0 + 45000);

    expect(await reserveBatch(r, 3000, T0 + 45000)).toBeUndefined();
    expect(await reserveBatch(routing({ gemini: false }), 5000, T0 + 45000)).toBeUndefined();
  });
});

describe("settleCall", () => {
  it("settles on the reserved provider, charges Gemini after a fallback, and releases when no LLM was called", async () => {
    const r = routing();
    const groq = (await reserveBatch(r, 3000, T0 + 45000))!;
    settleCall(r, groq, { provider: "groq", promptTokens: 250, completionTokens: 50 });
    // 300 of Groq's 6400 used, so another 3K batch (6000 with overhead) fits Groq again.
    expect((await reserveBatch(r, 3000, T0 + 45000))?.provider).toBe("groq");

    const r2 = routing();
    const fellBack = (await reserveBatch(r2, 3000, T0 + 45000))!;
    const charge = vi.spyOn(r2.budgets.gemini!, "charge");
    settleCall(r2, fellBack, { provider: "gemini", promptTokens: 700, completionTokens: 50 });
    expect(charge).toHaveBeenCalledWith({ requests: 1, tokens: 750 });
    expect((await reserveBatch(r2, 3000, T0 + 45000))?.provider).toBe("groq");

    const r3 = routing();
    const unused = (await reserveBatch(r3, 3000, T0 + 45000))!;
    settleCall(r3, unused, undefined);
    expect((await reserveBatch(r3, 3000, T0 + 45000))?.provider).toBe("groq");
  });
});
