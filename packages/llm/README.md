# @code-sentinel/llm

The LLM layer (`class_llm.mmd`): **Groq is the primary review provider and Gemini the secondary**,
with one quota budget per provider so production never receives a 429. Gemini also produces the
embeddings for the vector database. Design and numbers: [`plans/large-diffs.md`](../../plans/large-diffs.md)
and [`plans/llm-agents.md`](../../plans/llm-agents.md).

| Export | What it does |
| --- | --- |
| `LlmClient` | `complete(request, { provider, signal?, deadlineAt? })` calls the provider whose quota the orchestrator reserved. When that is Groq and the call fails on a 429, a 5xx, the network or a timeout, it retries once on Gemini (`fallbackDepth: 1`) if at least 2 s remain. A Groq call is cut at `groqTimeoutMs` (15 s) to leave room for that; a Gemini call may use all the time left before `deadlineAt` (60 s without one), because the free tier took 15–22 s per call in the 27-Sep live check. A prompt over `maxInputTokens` throws `InputTooLargeError` before any request |
| `createLlmClient(limits)` | The client an agent uses, from `loadLlmLimits()`: whichever of Groq and Gemini has a key, `maxInputTokens` = batch + prompt reserve. Undefined when neither key is set |
| `GroqProvider` | `POST https://api.groq.com/openai/v1/chat/completions` with `response_format: json_schema` (`strict: true`), `max_completion_tokens`, `reasoning_effort: "low"`. Reads `usage` |
| `GeminiProvider` | `POST …/v1beta/models/{model}:generateContent` with `responseMimeType: application/json` + `responseJsonSchema`, `maxOutputTokens`. Reads `usageMetadata` (thinking tokens count as output) |
| `QuotaBudget` | `tryReserve({ requests, tokens })` → a `Reservation`, or `{ retryAt }` (`null` when the cost can never fit). `settle()` swaps the estimate for the reported tokens; `release()` returns an unused reservation. Sliding 60 s and rolling 24 h windows, at `headroom` × each limit |
| `GeminiEmbedder` | `embedMany(texts)`: one `embedContent` per text, `outputDimensionality: 768`, each reserved on the embedding budget |
| `loadLlmLimits(env)` | Reads the variables below; a provider is enabled by its API key. Throws `LlmConfigError` listing every bad variable |
| `estimateTokens(text)` | `ceil(bytes / 3)`, pessimistic, no tokenizer |

Both providers use raw `fetch` (no SDK). Errors are typed and never contain the prompt or the key:
`LlmProviderError` (`kind`: `rate_limited`, `http`, `network`, `timed_out`, `aborted`,
`invalid_response`), `LlmQuotaError` for a 429 or a full local budget (maps to
`llm_quota_exhausted`), `InputTooLargeError` (maps to a `too_large` skip), and `LlmUnavailableError`
when the requested provider has no key.

**Response schemas.** Groq's strict mode needs every property listed in `required` and every
object closed with `additionalProperties: false`. Write schemas that way and both providers accept
them. The caller still validates the returned JSON (with zod): the model output is untrusted.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `GROQ_API_KEY` | unset | Enables Groq |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Free-tier models: `gpt-oss-120b`, `gpt-oss-20b`, `gpt-oss-safeguard-20b`, `qwen3.8-27b` (Llama left the free tier on 16-Aug-2026) |
| `GROQ_RPM` / `GROQ_TPM` / `GROQ_RPD` / `GROQ_TPD` | 30 / 8000 / 1000 / 200000 | Limits of **this environment's** Groq key |
| `GEMINI_API_KEY` | unset | Enables Gemini (review fallback and embeddings) |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Secondary review model |
| `GEMINI_RPM` / `GEMINI_TPM` / `GEMINI_RPD` | 15 / 250000 / 500 | Limits of this environment's Gemini key |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-2` | 768-dimension vectors |
| `GEMINI_EMBED_RPM` / `TPM` / `RPD` | unset | From the key's quota page; embeddings stay off until all three are set |
| `LLM_QUOTA_HEADROOM` | `0.8` | Share of every limit we use, in (0, 1] |
| `LLM_MAX_OUTPUT_TOKENS` | `2000` | Output cap per call; counts against TPM |
| `LLM_MAX_FILE_TOKENS` | `6000` | A larger file is `too_large` |
| `LLM_MAX_BATCH_TOKENS` | `12000` | Diff tokens per call (Groq batches are further capped by its TPM) |
| `LLM_REVIEW_MAX_TOKENS` | `24000` | Diff tokens per LLM agent per review; the rest is `over_budget` |
| `LLM_PROMPT_RESERVE_TOKENS` | `1000` | System prompt allowance per call |

Development and production use separate keys, each with its own limits.

## Develop

```bash
npm run test  -w @code-sentinel/llm   # every test stubs fetch; no key is ever used
npm run build -w @code-sentinel/llm
```
