import type { Health } from "@code-sentinel/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { wakeAgent } from "./wake-agent.js";

const OK: Health = { status: "ok", version: "1.0.0" };

describe("wakeAgent", () => {
  afterEach(() => vi.useRealTimers());

  it("retries until the agent answers", async () => {
    vi.useFakeTimers();
    const health = vi.fn().mockRejectedValueOnce(new Error("502")).mockRejectedValueOnce(new Error("502")).mockResolvedValue(OK);

    const woke = wakeAgent({ health }, 90_000);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(woke).resolves.toBe(true);
    expect(health).toHaveBeenCalledTimes(3);
  });

  it("gives up at the deadline", async () => {
    vi.useFakeTimers();
    const health = vi.fn().mockRejectedValue(new Error("unreachable"));

    const woke = wakeAgent({ health }, 5_000);
    await vi.advanceTimersByTimeAsync(6_000);

    await expect(woke).resolves.toBe(false);
    expect(health.mock.calls.length).toBeGreaterThan(1);
  });

  it("stops when the run is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(wakeAgent({ health: vi.fn() }, 90_000, controller.signal)).resolves.toBe(false);
  });
});
