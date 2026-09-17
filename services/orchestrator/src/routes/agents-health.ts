import type { AgentHealthEntry, AgentHealthSnapshot, AgentKind } from "@code-sentinel/contracts";
import { Router } from "express";

import type { AgentClient } from "../agents/agent-client.js";
import { ALL_AGENTS } from "../graph/defaults.js";

export type HealthClients = Partial<Record<AgentKind, Pick<AgentClient, "health">>>;

export interface AgentsHealthRouterDeps {
  clients: HealthClients;
  /** A snapshot younger than this is served from cache. */
  cacheMs?: number;
  /** Per-agent budget for one health call. */
  timeoutMs?: number;
  now?: () => Date;
}

/** `GET /agents/health`: the last known health of each agent, polled on demand and cached. */
export function createAgentsHealthRouter(deps: AgentsHealthRouterDeps): Router {
  const { clients, cacheMs = 30_000, timeoutMs = 2_000, now = () => new Date() } = deps;
  let cached: { snapshot: Promise<AgentHealthSnapshot>; at: number } | undefined;

  const router = Router();
  router.get("/agents/health", async (_req, res) => {
    const at = now().getTime();
    // Caching the promise means concurrent requests share one round of health calls.
    if (!cached || at - cached.at >= cacheMs) cached = { snapshot: poll(clients, timeoutMs, now), at };
    res.json(await cached.snapshot);
  });
  return router;
}

async function poll(clients: HealthClients, timeoutMs: number, now: () => Date): Promise<AgentHealthSnapshot> {
  const agents = await Promise.all(
    ALL_AGENTS.map(async (agent): Promise<AgentHealthEntry> => {
      const client = clients[agent];
      if (!client) return { agent, status: "unavailable" };

      const started = performance.now();
      try {
        const health = await client.health({ timeoutMs });
        const entry: AgentHealthEntry = { agent, status: health.status, latencyMs: Math.round(performance.now() - started) };
        if (health.version) entry.version = health.version;
        return entry;
      } catch {
        return { agent, status: "unavailable" };
      }
    }),
  );
  return { checkedAt: now().toISOString(), agents };
}
