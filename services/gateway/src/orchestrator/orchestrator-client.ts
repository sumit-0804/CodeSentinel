import {
  HealthSchema,
  ReviewJobSchema,
  type Health,
  type ReviewJob,
  type ReviewJobRequestInput,
} from "@code-sentinel/contracts";

import { OrchestratorCallError } from "./orchestrator-call-error.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OrchestratorClientOptions {
  /** e.g. `http://orchestrator.internal:8080`. A trailing slash is ignored. */
  baseUrl: string;
  serviceToken: string;
  timeoutMs: number;
  /** Defaults to the global `fetch`; injected in tests. */
  fetch?: FetchLike;
}

export interface CreateReviewJobOptions {
  /** The GitHub delivery id for webhook reviews, so a redelivery returns the existing job. */
  idempotencyKey?: string;
  /** Propagated as `X-Request-Id` (NFR-12). */
  requestId?: string;
}

export interface CreatedReviewJob {
  job: ReviewJob;
  /** `false` when the orchestrator answered 200 with an existing job for the idempotency key. */
  created: boolean;
}

interface ResponseSchema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: unknown };
}

interface SendOptions<T> {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  schema: ResponseSchema<T>;
  /** Statuses that count as success; anything else is an `http` error. */
  successStatuses: readonly number[];
}

/** HTTP client for `docs/design/openapi/orchestrator.yaml`; every response is validated before it is returned. */
export class OrchestratorClient {
  private readonly baseUrl: string;
  private readonly serviceToken: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: OrchestratorClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.serviceToken = options.serviceToken;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** `POST /internal/v1/review-jobs` (FR-GW-04). 202 starts a job; 200 returns the existing one. */
  async createReviewJob(request: ReviewJobRequestInput, opts: CreateReviewJobOptions = {}): Promise<CreatedReviewJob> {
    const headers: Record<string, string> = {};
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    if (opts.requestId) headers["X-Request-Id"] = opts.requestId;

    const { data, status } = await this.send({
      method: "POST",
      path: "/internal/v1/review-jobs",
      body: request,
      headers,
      schema: ReviewJobSchema,
      successStatuses: [200, 202],
    });
    return { job: data, created: status === 202 };
  }

  /** `GET /healthz`. */
  async health(): Promise<Health> {
    const { data } = await this.send({ method: "GET", path: "/healthz", schema: HealthSchema, successStatuses: [200] });
    return data;
  }

  private async send<T>(options: SendOptions<T>): Promise<{ data: T; status: number }> {
    const { method, path, body, schema, successStatuses } = options;
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.serviceToken}`,
      ...options.headers,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      // Reading the body is still bound to the signal, so a stalled stream also times out.
      text = await response.text();
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new OrchestratorCallError(
        timedOut ? `orchestrator did not answer ${method} ${path} in time` : `orchestrator unreachable on ${method} ${path}`,
        { kind: timedOut ? "timed_out" : "network", latencyMs: elapsed(), cause: error },
      );
    }

    if (!successStatuses.includes(response.status)) {
      throw new OrchestratorCallError(`orchestrator returned HTTP ${response.status} for ${method} ${path}`, {
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
    return { data: parsed.data, status: response.status };
  }

  private invalid(method: string, path: string, latencyMs: number, cause: unknown): OrchestratorCallError {
    return new OrchestratorCallError(`orchestrator sent an invalid body for ${method} ${path}`, {
      kind: "invalid_response",
      latencyMs,
      cause,
    });
  }
}

/** The slice of the client the app uses, so tests can pass plain objects. */
export type OrchestratorClientLike = Pick<OrchestratorClient, "createReviewJob" | "health">;
