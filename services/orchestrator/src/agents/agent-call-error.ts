import type { AgentKind } from "@code-sentinel/contracts";

/**
 * Why an agent call produced no usable response.
 *
 * - `timed_out`: the per-agent timeout fired before the agent answered (NFR-02).
 * - `http`: the agent answered with a non-2xx status (e.g. 503 when Gemini is unavailable).
 * - `invalid_response`: the body was not JSON or did not match the agent contract.
 * - `network`: fetch itself failed (connection refused, DNS, reset).
 */
export type AgentCallErrorKind = "timed_out" | "http" | "invalid_response" | "network";

export interface AgentCallErrorInit {
  agent: AgentKind;
  kind: AgentCallErrorKind;
  latencyMs: number;
  status?: number;
  cause?: unknown;
}

/** Thrown by `AgentClient` for every failed call, so the fan-out can map it to a run summary. */
export class AgentCallError extends Error {
  readonly agent: AgentKind;
  readonly kind: AgentCallErrorKind;
  readonly latencyMs: number;
  readonly status?: number;

  constructor(message: string, init: AgentCallErrorInit) {
    super(message, { cause: init.cause });
    this.name = "AgentCallError";
    this.agent = init.agent;
    this.kind = init.kind;
    this.latencyMs = init.latencyMs;
    if (init.status !== undefined) this.status = init.status;
  }
}
