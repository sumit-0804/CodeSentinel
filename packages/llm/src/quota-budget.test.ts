import { describe, expect, it } from "vitest";

import { QuotaBudget, type QuotaLimits } from "./quota-budget.js";

const GROQ: QuotaLimits = { requestsPerMinute: 30, tokensPerMinute: 8000, requestsPerDay: 1000, tokensPerDay: 200000 };
const T0 = Date.parse("2026-09-27T10:00:00.000Z");

function clock() {
  let now = T0;
  return { now: () => new Date(now), advance: (ms: number) => (now += ms) };
}

describe("QuotaBudget", () => {
  it("allows only the headroom share of each limit", () => {
    const { now } = clock();
    const budget = new QuotaBudget(GROQ, { headroom: 0.8, now });

    expect(budget.tryReserve({ requests: 1, tokens: 6400 }).ok).toBe(true);
    const next = budget.tryReserve({ requests: 1, tokens: 1 });

    expect(next).toEqual({ ok: false, retryAt: new Date(T0 + 60_001) });
  });

  it("refuses a cost that can never fit with retryAt null", () => {
    const budget = new QuotaBudget(GROQ, { headroom: 0.8, now: clock().now });

    expect(budget.tryReserve({ requests: 1, tokens: 6401 })).toEqual({ ok: false, retryAt: null });
  });

  it("frees capacity as the minute slides, from the oldest entry first", () => {
    const { now, advance } = clock();
    const budget = new QuotaBudget(GROQ, { headroom: 0.8, now });
    budget.tryReserve({ requests: 1, tokens: 3000 });
    advance(20_000);
    budget.tryReserve({ requests: 1, tokens: 3000 });

    const blocked = budget.tryReserve({ requests: 1, tokens: 3000 });
    expect(blocked).toEqual({ ok: false, retryAt: new Date(T0 + 60_001) });

    advance(40_001);
    expect(budget.tryReserve({ requests: 1, tokens: 3000 }).ok).toBe(true);
  });

  it("enforces requests per minute and the rolling day", () => {
    const { now, advance } = clock();
    const budget = new QuotaBudget({ requestsPerMinute: 2, tokensPerMinute: 1000, requestsPerDay: 3 }, { headroom: 1, now });
    budget.tryReserve({ requests: 1, tokens: 1 });
    budget.tryReserve({ requests: 1, tokens: 1 });
    expect(budget.tryReserve({ requests: 1, tokens: 1 }).ok).toBe(false);

    advance(60_001);
    expect(budget.tryReserve({ requests: 1, tokens: 1 }).ok).toBe(true);
    advance(60_001);
    expect(budget.tryReserve({ requests: 1, tokens: 1 })).toEqual({ ok: false, retryAt: new Date(T0 + 86_400_001) });
  });

  it("settles to the reported tokens and releases unused reservations", () => {
    const { now } = clock();
    const budget = new QuotaBudget(GROQ, { headroom: 0.8, now });
    const first = budget.tryReserve({ requests: 1, tokens: 6000 });
    if (!first.ok) throw new Error("expected a reservation");

    budget.settle(first.reservation, 1000);
    const second = budget.tryReserve({ requests: 1, tokens: 5000 });
    expect(second.ok).toBe(true);

    if (second.ok) budget.release(second.reservation);
    expect(budget.tryReserve({ requests: 1, tokens: 5400 }).ok).toBe(true);
  });
});
