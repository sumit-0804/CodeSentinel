export type LlmProviderName = "groq" | "gemini";

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
  provider: LlmProviderName;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface LlmResponse extends ProviderResponse {
  /** 0 when the requested provider answered; 1 when Gemini answered after Groq failed. */
  fallbackDepth: number;
}

export interface ProviderCallOptions {
  signal?: AbortSignal;
}

/** A request as providers receive it, with the output cap already resolved by the client. */
export type ProviderRequest = LlmRequest & { maxOutputTokens: number };

export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly model: string;
  complete(request: ProviderRequest, options?: ProviderCallOptions): Promise<ProviderResponse>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
