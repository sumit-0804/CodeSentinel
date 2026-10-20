import type { AgentHealthEntry, AgentHealthSnapshot, AgentKind } from "@code-sentinel/contracts";
import { Router } from "express";

import { AgentCallError } from "../agents/agent-call-error.js";
import type { AgentClient } from "../agents/agent-client.js";
import { wakeAgent } from "../agents/wake-agent.js";
import { ALL_AGENTS } from "../graph/defaults.js";

export type HealthClients = Partial<Record<AgentKind, Pick<AgentClient, "health">>>;

export interface AgentsHealthRouterDeps {
  clients: HealthClients;
  /** A snapshot younger than this is served from cache. */
  cacheMs?: number;
  /** Per-agent budget for one health call. */
  timeoutMs?: number;
  /** `AGENT_WAKE_TIMEOUT_MS`: agents sleep when idle, so a timed-out call means "asleep" and starts a wake. 0 = off. */
  wakeMs?: number;
  now?: () => Date;
}

/** `GET /agents/health`: the last known health of each agent, polled on demand and cached. */
export function createAgentsHealthRouter(deps: AgentsHealthRouterDeps): Router {
  const { clients, cacheMs = 30_000, timeoutMs = 2_000, wakeMs = 0, now = () => new Date() } = deps;
  let cached: { snapshot: Promise<AgentHealthSnapshot>; at: number } | undefined;
  const waking = new Set<AgentKind>();
  // An agent whose last wake gave up is reported as down, not asleep, until it answers again.
  const failedWake = new Set<AgentKind>();

  const wake = (agent: AgentKind, client: Pick<AgentClient, "health">) => {
    if (waking.has(agent)) return;
    waking.add(agent);
    void wakeAgent(client, wakeMs).then((woke) => {
      waking.delete(agent);
      if (woke) failedWake.delete(agent);
      else failedWake.add(agent);
      cached = undefined;
    });
  };

  const poll = async (): Promise<AgentHealthSnapshot> => {
    const agents = await Promise.all(
      ALL_AGENTS.map(async (agent): Promise<AgentHealthEntry> => {
        const client = clients[agent];
        if (!client) return { agent, status: "unavailable" };

        const started = performance.now();
        try {
          const health = await client.health({ timeoutMs });
          failedWake.delete(agent);
          const entry: AgentHealthEntry = { agent, status: health.status, latencyMs: Math.round(performance.now() - started) };
          if (health.version) entry.version = health.version;
          return entry;
        } catch (error) {
          // A sleeping host holds the request while it boots, so the call times out rather than failing fast.
          const sleeping = wakeMs > 0 && error instanceof AgentCallError && error.kind === "timed_out" && !failedWake.has(agent);
          if (!sleeping) return { agent, status: "unavailable" };
          wake(agent, client);
          return { agent, status: "unavailable", asleep: true };
        }
      }),
    );
    return { checkedAt: now().toISOString(), agents };
  };

  const router = Router();
  router.get("/agents/health", async (_req, res) => {
    const at = now().getTime();
    // Caching the promise means concurrent requests share one round of health calls.
    if (!cached || at - cached.at >= cacheMs) cached = { snapshot: poll(), at };
    res.json(await cached.snapshot);
  });
  return router;
}
