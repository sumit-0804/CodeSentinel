import type { AgentClient } from "./agent-client.js";

const RETRY_DELAY_MS = 2000;

/**
 * Pings `/healthz` until the agent answers or `wakeMs` runs out. A sleeping free-tier host (Render)
 * takes about a minute to start; the review call afterwards still gets its full timeout.
 */
export async function wakeAgent(client: Pick<AgentClient, "health">, wakeMs: number, signal?: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + wakeMs;
  while (!signal?.aborted) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    try {
      await client.health({ timeoutMs: remaining, ...(signal ? { signal } : {}) });
      return true;
    } catch {
      // A 502 while the host boots, or no answer yet: try again until the deadline.
      await sleep(Math.min(RETRY_DELAY_MS, Math.max(0, deadline - Date.now())), signal);
    }
  }
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
