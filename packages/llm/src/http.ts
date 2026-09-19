import { LlmProviderError, LlmQuotaError } from "./errors.js";
import type { FetchLike, LlmProviderName } from "./types.js";

export interface JsonResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

/** POSTs JSON and maps transport failures to `LlmProviderError`; non-2xx bodies are returned. */
export async function postJson(
  fetchImpl: FetchLike,
  provider: LlmProviderName,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal | undefined,
): Promise<JsonResponse> {
  let response: Response;
  let text: string;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    text = await response.text();
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const kind = name === "TimeoutError" ? "timed_out" : name === "AbortError" ? "aborted" : "network";
    throw new LlmProviderError(`${provider} request ${kind === "network" ? "failed" : kind.replace("_", " ")}`, {
      provider,
      kind,
      cause: error,
    });
  }

  let parsed: unknown;
  try {
    parsed = text === "" ? undefined : JSON.parse(text);
  } catch (error) {
    throw new LlmProviderError(`${provider} returned a non-JSON body (HTTP ${response.status})`, {
      provider,
      kind: response.ok ? "invalid_response" : "http",
      status: response.status,
      cause: error,
    });
  }
  return { status: response.status, headers: response.headers, body: parsed };
}

/** The error for a non-2xx answer; 429 becomes `LlmQuotaError` with the provider's retry hint. */
export function httpError(provider: LlmProviderName, status: number, retryAfterMs: number | undefined): LlmProviderError {
  const options = { provider, status, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
  if (status === 429) return new LlmQuotaError(`${provider} rate limit reached`, options);
  return new LlmProviderError(`${provider} returned HTTP ${status}`, { ...options, kind: "http" });
}

export function invalid(provider: LlmProviderName, reason: string, cause?: unknown): LlmProviderError {
  return new LlmProviderError(`${provider} sent an unusable answer: ${reason}`, {
    provider,
    kind: "invalid_response",
    ...(cause !== undefined ? { cause } : {}),
  });
}
