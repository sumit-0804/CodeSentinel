/** The providers the orchestrator reserves quota on and assigns to a call. */
export type LlmProviderName = "groq" | "gemini";
/** Anything that can answer: Cloudflare is only the last fallback, never assigned. */
export type LlmBackendName = LlmProviderName | "cloudflare";

/** A JSON Schema object. For Groq strict mode every property must be required and objects closed. */
export type JsonSchema = Record<string, unknown>;

export interface LlmRequest {
  systemPrompt: string;
  /** The user turn: instructions plus the diff hunks under review. */
  prompt: string;
  /** Names the schema in Groq's `json_schema` response format. */
  schemaName: string;
  responseSchema: JsonSchema;
  /** Defaults to the client's `LLM_MAX_OUTPUT_TOKENS`. */
  maxOutputTokens?: number;
  temperature?: number;
}

/** What a single provider returns; the client adds `fallbackDepth`. */
export interface ProviderResponse {
  /** The JSON text the model produced; the caller parses and validates it. */
  text: string;
  provider: LlmBackendName;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface LlmResponse extends ProviderResponse {
  /** 0 when the requested provider answered; otherwise how many fallbacks were tried (Gemini, then Cloudflare). */
  fallbackDepth: number;
}

export interface ProviderCallOptions {
  signal?: AbortSignal;
}

/** A request as providers receive it, with the output cap already resolved by the client. */
export type ProviderRequest = LlmRequest & { maxOutputTokens: number };

export interface LlmProvider {
  readonly name: LlmBackendName;
  readonly model: string;
  complete(request: ProviderRequest, options?: ProviderCallOptions): Promise<ProviderResponse>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
