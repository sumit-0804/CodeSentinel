import "server-only";
import { cache } from "react";
import { AgentsHealthSchema, type AgentsHealth } from "@code-sentinel/contracts";
import { gatewayFetch } from "@/lib/gateway";

/** Each agent's health from the gateway, once per request; undefined when it can't be read (no notice then). */
export const getAgentHealth = cache(async (): Promise<AgentsHealth | undefined> => {
  const result = await gatewayFetch("/v1/agents/health", AgentsHealthSchema);
  return result.ok ? result.data : undefined;
});
