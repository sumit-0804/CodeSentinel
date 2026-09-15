import type { AgentKind } from "@code-sentinel/contracts";

import { ALL_AGENTS, DEFAULT_AGENT_TIMEOUT_MS } from "../graph/defaults.js";
import { AgentClient, type FetchLike } from "./agent-client.js";

const URL_ENV: Record<AgentKind, string> = {
  security: "AGENT_SECURITY_URL",
  style: "AGENT_STYLE_URL",
  performance: "AGENT_PERFORMANCE_URL",
  logic: "AGENT_LOGIC_URL",
  documentation: "AGENT_DOCUMENTATION_URL",
};

/** Same bounds as `ReviewJobRequest.agentTimeoutMs`. */
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120000;

export interface AgentConfig {
  /** Only agents with a URL set appear here; the rest are `skipped` at fan-out. */
  urls: Partial<Record<AgentKind, string>>;
  serviceToken?: string;
  /** Client default. A review job's own `agentTimeoutMs` overrides it per call. */
  timeoutMs: number;
}

/**
 * Reads agent endpoints and the service token from the environment (see `.env.example`).
 * Throws on an invalid `AGENT_TIMEOUT_MS` so a typo fails at startup, not on the first review.
 */
export function loadAgentConfig(env: Record<string, string | undefined> = process.env): AgentConfig {
  const urls: Partial<Record<AgentKind, string>> = {};
  for (const agent of ALL_AGENTS) {
    const url = env[URL_ENV[agent]]?.trim();
    if (url) urls[agent] = url;
  }

  const config: AgentConfig = { urls, timeoutMs: parseTimeout(env.AGENT_TIMEOUT_MS) };
  const serviceToken = env.SERVICE_TOKEN?.trim();
  if (serviceToken) config.serviceToken = serviceToken;
  return config;
}

/** One `AgentClient` per configured agent. */
export function createAgentClients(
  config: AgentConfig,
  fetchImpl?: FetchLike,
): Partial<Record<AgentKind, AgentClient>> {
  const clients: Partial<Record<AgentKind, AgentClient>> = {};
  for (const agent of ALL_AGENTS) {
    const baseUrl = config.urls[agent];
    if (!baseUrl) continue;
    clients[agent] = new AgentClient({
      agent,
      baseUrl,
      timeoutMs: config.timeoutMs,
      ...(config.serviceToken ? { serviceToken: config.serviceToken } : {}),
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
  }
  return clients;
}

function parseTimeout(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_AGENT_TIMEOUT_MS;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new Error(
      `AGENT_TIMEOUT_MS must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} ms, got "${raw}"`,
    );
  }
  return value;
}
