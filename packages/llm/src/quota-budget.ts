/** A provider key's free-tier limits. `tokensPerDay` is set only where the provider has one (Groq). */
export interface QuotaLimits {
  requestsPerMinute: number;
  tokensPerMinute: number;
  requestsPerDay: number;
  tokensPerDay?: number;
}

export interface QuotaCost {
  requests: number;
  tokens: number;
}

export interface Reservation {
  readonly id: number;
  readonly cost: QuotaCost;
}

/** `retryAt: null` means the cost can never fit, even with an empty window. */
export type ReserveResult = { ok: true; reservation: Reservation } | { ok: false; retryAt: Date | null };

export interface QuotaBudgetOptions {
  /** Share of each limit we allow ourselves, e.g. 0.8. */
  headroom: number;
  now?: () => Date;
}

interface Entry {
  id: number;
  at: number;
  requests: number;
  tokens: number;
}

interface Window {
  spanMs: number;
  field: "requests" | "tokens";
  limit: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Reserves requests and tokens against one provider key before a call is made, so the key never
 * returns a 429 (`plans/large-diffs.md`). Windows slide: a minute and a rolling 24 hours.
 */
export class QuotaBudget {
  private readonly windows: Window[];
  private readonly now: () => Date;
  private entries: Entry[] = [];
  private nextId = 1;

  constructor(limits: QuotaLimits, options: QuotaBudgetOptions) {
    const allowed = (limit: number) => Math.max(1, Math.floor(limit * options.headroom));
    this.windows = [
      { spanMs: MINUTE_MS, field: "requests", limit: allowed(limits.requestsPerMinute) },
      { spanMs: MINUTE_MS, field: "tokens", limit: allowed(limits.tokensPerMinute) },
      { spanMs: DAY_MS, field: "requests", limit: allowed(limits.requestsPerDay) },
    ];
    if (limits.tokensPerDay !== undefined) {
      this.windows.push({ spanMs: DAY_MS, field: "tokens", limit: allowed(limits.tokensPerDay) });
    }
    this.now = options.now ?? (() => new Date());
  }

  tryReserve(cost: QuotaCost): ReserveResult {
    const now = this.now().getTime();
    this.prune(now);

    let retryAt = now;
    for (const window of this.windows) {
      if (cost[window.field] > window.limit) return { ok: false, retryAt: null };
      const inWindow = this.entries.filter((entry) => entry.at > now - window.spanMs);
      let excess = sum(inWindow, window.field) + cost[window.field] - window.limit;
      if (excess <= 0) continue;
      // Oldest entries leave the window first; wait until enough of them have.
      for (const entry of inWindow) {
        excess -= entry[window.field];
        if (excess <= 0) {
          retryAt = Math.max(retryAt, entry.at + window.spanMs + 1);
          break;
        }
      }
    }
    if (retryAt > now) return { ok: false, retryAt: new Date(retryAt) };

    const reservation: Reservation = { id: this.nextId++, cost: { ...cost } };
    this.entries.push({ id: reservation.id, at: now, ...cost });
    return { ok: true, reservation };
  }

  /** Replaces the estimate with what the provider reported, keeping the original time. */
  settle(reservation: Reservation, actualTokens: number): void {
    const entry = this.entries.find((candidate) => candidate.id === reservation.id);
    if (entry) entry.tokens = Math.max(0, actualTokens);
  }

  /** Gives back a reservation whose call was never made (cancelled, or sent elsewhere). */
  release(reservation: Reservation): void {
    this.entries = this.entries.filter((entry) => entry.id !== reservation.id);
  }

  private prune(now: number): void {
    this.entries = this.entries.filter((entry) => entry.at > now - DAY_MS);
  }
}

function sum(entries: Entry[], field: "requests" | "tokens"): number {
  return entries.reduce((total, entry) => total + entry[field], 0);
}
