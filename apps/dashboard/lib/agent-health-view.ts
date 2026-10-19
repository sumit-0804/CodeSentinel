import type { AgentKind, AgentsHealth } from "@code-sentinel/contracts";

export type AgentHealthStatus = AgentsHealth["agents"][number]["status"];

/** What the dashboard says about an agent that isn't healthy; healthy agents need no words. */
export const HEALTH_WORD: Record<Exclude<AgentHealthStatus, "ok">, string> = {
  degraded: "Running without its AI checks",
  unavailable: "Not answering",
  unknown: "Status unknown",
};

export type HealthByAgent = Partial<Record<AgentKind, AgentHealthStatus>>;

export function healthByAgent(health: AgentsHealth): HealthByAgent {
  return Object.fromEntries(health.agents.map(({ agent, status }) => [agent, status]));
}

export interface HealthNotice {
  tone: "warn" | "crit";
  title: string;
  body: string;
}

/**
 * One sentence about the agents that aren't healthy, or nothing when all are. `onlyAgents` limits it to
 * the agents a repository actually runs.
 */
export function healthNotice(health: AgentsHealth, names: Record<AgentKind, string>, onlyAgents?: readonly AgentKind[]): HealthNotice | undefined {
  const agents = health.agents.filter((entry) => !onlyAgents || onlyAgents.includes(entry.agent));
  if (agents.length > 0 && agents.every((entry) => entry.status === "unknown")) {
    return { tone: "warn", title: "Can't check the agents right now", body: "The review service didn't answer. Reviews may be delayed." };
  }
  const down = agents.filter((entry) => entry.status === "unavailable").map((entry) => names[entry.agent]);
  const degraded = agents.filter((entry) => entry.status === "degraded").map((entry) => names[entry.agent]);
  if (down.length > 0) {
    return {
      tone: "crit",
      title: `${list(down)} ${down.length === 1 ? "isn't" : "aren't"} answering`,
      body: `New reviews mark ${down.length === 1 ? "it" : "them"} "no result" until ${down.length === 1 ? "it's" : "they're"} back. Other agents still review.`,
    };
  }
  if (degraded.length > 0) {
    return {
      tone: "warn",
      title: `${list(degraded)} ${degraded.length === 1 ? "is" : "are"} running without AI checks`,
      body: "Rule-based checks still run; the AI part is skipped until an LLM key or quota is back.",
    };
  }
  return undefined;
}

function list(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
