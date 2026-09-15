import type { AgentKind } from "@code-sentinel/contracts";

/** The five agents in contract order. `enabledAgents` omitted on a job means all of these. */
export const ALL_AGENTS: readonly AgentKind[] = [
  "security",
  "style",
  "performance",
  "logic",
  "documentation",
];

/** Platform default when the repository sets no override (FR-ORC-06, FR-WEB-03). */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

/** Per-agent budget before the orchestrator proceeds without that agent (NFR-02). */
export const DEFAULT_AGENT_TIMEOUT_MS = 20000;

/**
 * Subtracted from the timeout to give the agent its `options.deadlineMs`, so it has time to send
 * what it has before the orchestrator abandons the call.
 */
export const DEADLINE_MARGIN_MS = 2000;
