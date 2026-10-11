import { describe, expect, it } from "vitest";

import { describeJobStoreContract, freshRequest, queuedJob } from "../test-support/job-store-contract.js";
import { InMemoryJobStore } from "./job-store.js";

const HOUR = 3_600_000;

describe("InMemoryJobStore", () => {
  describeJobStoreContract(async () => ({
    store: new InMemoryJobStore({ retentionMs: HOUR }),
    request: (overrides) => freshRequest({}, overrides),
  }));

  it("drops finished jobs and their keys past the retention window on the next insert", async () => {
    let now = new Date("2026-09-27T12:00:00.000Z");
    const store = new InMemoryJobStore({ retentionMs: HOUR, now: () => now });
    const old = queuedJob();
    const oldRequest = freshRequest();
    const recent = queuedJob();
    const running = queuedJob();
    await store.insert(old, oldRequest, "delivery-old");
    await store.complete({ ...old, status: "completed", completedAt: "2026-09-27T10:30:00.000Z" });
    await store.insert(recent, freshRequest());
    await store.complete({ ...recent, status: "cancelled", completedAt: "2026-09-27T11:30:00.000Z" });
    await store.insert(running, freshRequest());

    now = new Date("2026-09-27T12:00:01.000Z");
    await store.insert(queuedJob(), freshRequest());

    await expect(store.get(old.jobId)).resolves.toBeUndefined();
    await expect(store.findByIdempotencyKey("delivery-old")).resolves.toBeUndefined();
    // The swept commit key no longer blocks a new review of that commit.
    await expect(store.insert(queuedJob(), oldRequest)).resolves.toMatchObject({ created: true });
    await expect(store.get(recent.jobId)).resolves.toBeDefined();
    await expect(store.get(running.jobId)).resolves.toBeDefined();
  });

  it("refuses to mark an unknown job running", async () => {
    await expect(new InMemoryJobStore({ retentionMs: HOUR }).markRunning("missing", "2026-09-27T12:00:00.000Z")).rejects.toThrow(
      /Unknown review job/,
    );
  });
});
