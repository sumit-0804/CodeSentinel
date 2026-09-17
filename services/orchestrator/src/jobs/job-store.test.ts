import { describe, expect, it } from "vitest";

import type { ReviewJob } from "@code-sentinel/contracts";
import { EXAMPLE_REVIEW_ID } from "@code-sentinel/contracts/examples";
import { InMemoryJobStore } from "./job-store.js";

const HOUR = 3_600_000;

function job(jobId: string, overrides: Partial<ReviewJob> = {}): ReviewJob {
  return { jobId, reviewId: EXAMPLE_REVIEW_ID, status: "running", createdAt: "2026-09-27T10:00:00.000Z", ...overrides };
}

describe("InMemoryJobStore", () => {
  it("finds a job by id and by its idempotency key", () => {
    const store = new InMemoryJobStore({ retentionMs: HOUR });
    store.insert(job("a"), "delivery-1");
    store.insert(job("b"));

    expect(store.get("a")?.jobId).toBe("a");
    expect(store.findByIdempotencyKey("delivery-1")?.jobId).toBe("a");
    expect(store.findByIdempotencyKey("delivery-2")).toBeUndefined();
    expect(store.get("missing")).toBeUndefined();
  });

  it("replaces a job on update and refuses an unknown one", () => {
    const store = new InMemoryJobStore({ retentionMs: HOUR });
    store.insert(job("a"), "delivery-1");

    store.update(job("a", { status: "completed" }));

    expect(store.findByIdempotencyKey("delivery-1")?.status).toBe("completed");
    expect(() => store.update(job("missing"))).toThrow(/Unknown review job/);
  });

  it("drops finished jobs and their keys past the retention window on the next insert", () => {
    let now = new Date("2026-09-27T12:00:00.000Z");
    const store = new InMemoryJobStore({ retentionMs: HOUR, now: () => now });
    store.insert(job("old", { status: "completed", completedAt: "2026-09-27T10:30:00.000Z" }), "delivery-old");
    store.insert(job("recent", { status: "cancelled", completedAt: "2026-09-27T11:30:00.000Z" }));
    store.insert(job("running"));

    now = new Date("2026-09-27T12:00:01.000Z");
    store.insert(job("new"));

    expect(store.get("old")).toBeUndefined();
    expect(store.findByIdempotencyKey("delivery-old")).toBeUndefined();
    expect(store.get("recent")).toBeDefined();
    expect(store.get("running")).toBeDefined();
  });
});
