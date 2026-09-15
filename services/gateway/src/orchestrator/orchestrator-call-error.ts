/** Why an orchestrator call failed: timeout, non-success status, invalid body, or fetch failure. */
export type OrchestratorCallErrorKind = "timed_out" | "http" | "invalid_response" | "network";

export interface OrchestratorCallErrorInit {
  kind: OrchestratorCallErrorKind;
  latencyMs: number;
  status?: number;
  cause?: unknown;
}

/** Thrown by `OrchestratorClient` for every failed call; the webhook maps it to 502 `orchestrator_unavailable`. */
export class OrchestratorCallError extends Error {
  readonly kind: OrchestratorCallErrorKind;
  readonly latencyMs: number;
  readonly status?: number;

  constructor(message: string, init: OrchestratorCallErrorInit) {
    super(message, { cause: init.cause });
    this.name = "OrchestratorCallError";
    this.kind = init.kind;
    this.latencyMs = init.latencyMs;
    if (init.status !== undefined) this.status = init.status;
  }
}
