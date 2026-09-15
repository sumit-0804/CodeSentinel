import {
  AgentReviewResponseSchema,
  CapabilitiesSchema,
  HealthSchema,
  type AgentKind,
  type AgentReviewRequest,
  type AgentReviewResponse,
  type Capabilities,
  type Health,
} from "@code-sentinel/contracts";

import { AgentCallError } from "./agent-call-error.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AgentClientOptions {
  agent: AgentKind;
  /** e.g. `http://security-agent.internal:8081`. A trailing slash is ignored. */
  baseUrl: string;
  /** Sent as `Authorization: Bearer <token>` when set. */
  serviceToken?: string;
  timeoutMs: number;
  /** Defaults to the global `fetch`; injected in tests. */
  fetch?: FetchLike;
}

export interface AgentCallOptions {
  /** Propagated as `X-Request-Id` so one review can be traced across services (NFR-12). */
  requestId?: string;
  /** Overrides the client's default timeout for this call. */
  timeoutMs?: number;
  /** Aborts the call early, e.g. when the review job is cancelled. */
  signal?: AbortSignal;
}

/** The slice of a zod schema the client needs, so the orchestrator does not import zod itself. */
interface ResponseSchema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: unknown };
}

interface SendOptions<T> extends AgentCallOptions {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  schema: ResponseSchema<T>;
  /** Extra check on a schema-valid body; a false result is an `invalid_response`. */
  accept?: (data: T) => boolean;
  /** Non-2xx statuses whose body is still a valid response (the 503 `Health` body). */
  acceptStatuses?: readonly number[];
}

/**
 * HTTP client for one agent service, speaking `docs/design/openapi/agent.yaml`.
 *
 * Every call runs under its own timeout (NFR-02) and every response is validated against the
 * contracts schema before it is returned, so a misbehaving agent surfaces as an
 * `AgentCallError` rather than as a malformed finding further down the graph.
 */
export class AgentClient {
  readonly agent: AgentKind;
  private readonly baseUrl: string;
  private readonly serviceToken?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: AgentClientOptions) {
    this.agent = options.agent;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    if (options.serviceToken) this.serviceToken = options.serviceToken;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** `POST /v1/review`. */
  review(request: AgentReviewRequest, opts: AgentCallOptions = {}): Promise<AgentReviewResponse> {
    return this.send({
      ...opts,
      method: "POST",
      path: "/v1/review",
      body: request,
      schema: AgentReviewResponseSchema,
      accept: (response) => response.agent === this.agent,
    });
  }

  /** `GET /v1/capabilities`. */
  capabilities(opts: AgentCallOptions = {}): Promise<Capabilities> {
    return this.send({
      ...opts,
      method: "GET",
      path: "/v1/capabilities",
      schema: CapabilitiesSchema,
      accept: (capabilities) => capabilities.agent === this.agent,
    });
  }

  /** `GET /healthz`. A 503 carrying a `Health` body is a valid "not ready" answer, not an error. */
  health(opts: AgentCallOptions = {}): Promise<Health> {
    return this.send({
      ...opts,
      method: "GET",
      path: "/healthz",
      schema: HealthSchema,
      acceptStatuses: [503],
    });
  }

  private async send<T>(options: SendOptions<T>): Promise<T> {
    const { method, path, body, schema, accept, requestId, signal, acceptStatuses = [] } = options;
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs);
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);

    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.serviceToken) headers.Authorization = `Bearer ${this.serviceToken}`;
    if (requestId) headers["X-Request-Id"] = requestId;

    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal,
      });
      // Reading the body is still bound to the signal, so a stalled stream also times out.
      text = await response.text();
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new AgentCallError(
        timedOut
          ? `${this.agent} agent did not answer ${method} ${path} in time`
          : `${this.agent} agent unreachable on ${method} ${path}`,
        { agent: this.agent, kind: timedOut ? "timed_out" : "network", latencyMs: elapsed(), cause: error },
      );
    }

    if (!response.ok && !acceptStatuses.includes(response.status)) {
      throw new AgentCallError(`${this.agent} agent returned HTTP ${response.status} for ${method} ${path}`, {
        agent: this.agent,
        kind: "http",
        status: response.status,
        latencyMs: elapsed(),
      });
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw this.invalid(method, path, elapsed(), error);
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) throw this.invalid(method, path, elapsed(), parsed.error);
    if (accept && !accept(parsed.data)) {
      throw this.invalid(method, path, elapsed(), new Error(`body does not belong to the ${this.agent} agent`));
    }
    return parsed.data;
  }

  private invalid(method: string, path: string, latencyMs: number, cause: unknown): AgentCallError {
    return new AgentCallError(`${this.agent} agent sent an invalid body for ${method} ${path}`, {
      agent: this.agent,
      kind: "invalid_response",
      latencyMs,
      cause,
    });
  }
}
