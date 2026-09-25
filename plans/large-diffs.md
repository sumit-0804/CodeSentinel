# Plan — Large diffs and LLM quota (cross-cutting)

Written 15-Sep-2026. Provider decision changed 27-Sep-2026: Groq primary, Gemini secondary
(see [`llm-agents.md`](llm-agents.md)).

## Decisions

- **Large diffs are skipped, never split.** A file is reviewed whole if it fits the limits;
  otherwise it is listed as skipped in the report.
- **Groq is the primary review provider, Gemini the secondary** (27-Sep; replaces "Gemini only").
  Groq runs `openai/gpt-oss-120b`; Gemini runs Gemini 3.5 Flash Lite. A batch goes to Groq when
  Groq's quota fits it now, otherwise to Gemini, and Gemini retries a Groq call that fails (429,
  5xx, network, timeout) with `fallbackDepth: 1`. Embeddings stay on Gemini (`gemini-embedding-2`,
  chosen 15-Sep over `gemini-embedding-001`) because Groq has no embedding model. No OpenRouter or
  Ollama.
- **Separate keys for development and production.** Each key has its own quota, so each environment
  sets its own `GROQ_*` and `GEMINI_*` limits. CI and unit tests stub `fetch` and never use a key.
- **Production must never receive a 429.** The orchestrator reserves quota on one provider before
  sending a batch; the runtime fallback to Gemini is only a last guard.
- Skipped files alone never make a review `partial`. An LLM agent deferred because the quota could
  not fit it before the deadline does (`skipped` + `errorCode: llm_quota_exhausted`).

## Budget

Free tiers, and the 80% we use:

| Provider | RPM | TPM | RPD | TPD | We use |
| --- | --- | --- | --- | --- | --- |
| Groq `openai/gpt-oss-120b` (console.groq.com, 27-Sep) | 30 | **8K** | 1K | 200K | 24 RPM, 6.4K TPM, 800 RPD, 160K TPD |
| Gemini 3.5 Flash Lite (AI Studio) | 15 | 250K | 500 | — | 12 RPM, 200K TPM, 400 RPD |

Both are tracked over a sliding minute and a rolling 24 hours. That is stricter than Gemini's
midnight-Pacific reset, so it is always safe. Groq's free tier dropped the Llama models on
16-Aug-2026; its free models are `gpt-oss-120b`, `gpt-oss-20b`, `gpt-oss-safeguard-20b` and
`qwen3.8-27b`, and the `gpt-oss` models support strict JSON-schema output.

**Groq's 8K TPM is the binding limit.** One call costs diff + prompt reserve + max output, so a
Groq batch is capped at about 6.4K − 1K − 2K ≈ 3K diff tokens, and Groq takes roughly one such
batch a minute. Everything else goes to Gemini.

| Env var | Default | Meaning |
| --- | --- | --- |
| `GROQ_API_KEY` | unset | Groq is used only when set |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Primary review model |
| `GROQ_RPM` / `GROQ_TPM` / `GROQ_RPD` / `GROQ_TPD` | 30 / 8000 / 1000 / 200000 | Limits of **this environment's** Groq key |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Secondary review model (confirm the id in AI Studio) |
| `GEMINI_RPM` / `GEMINI_TPM` / `GEMINI_RPD` | 15 / 250000 / 500 | Limits of **this environment's** Gemini key |
| `LLM_QUOTA_HEADROOM` | 0.8 | Share of each limit we use |
| `LLM_MAX_FILE_TOKENS` | 6000 | Larger file ⇒ `too_large` |
| `LLM_MAX_BATCH_TOKENS` | 12000 | Diff tokens per call (≈ 36 KB, ≈ 900 changed lines); Groq batches are further capped by its TPM |
| `LLM_REVIEW_MAX_TOKENS` | 24000 | Diff tokens per LLM agent per review; the rest ⇒ `over_budget` |
| `LLM_PROMPT_RESERVE_TOKENS` | 1000 | System prompt per call |
| `LLM_MAX_OUTPUT_TOKENS` | 2000 | Sent as `max_completion_tokens` (Groq) / `maxOutputTokens` (Gemini); counts against TPM |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-2` | Sent with `outputDimensionality: 768`; vectors come back L2-normalised (`embedding-config.ts`) |
| `GEMINI_EMBED_RPM` / `TPM` / `RPD` | from the key's quota page | Set in each environment's `.env` from the AI Studio quota page |

Tokens are estimated as `ceil(bytes / 3)` (pessimistic, no tokenizer); reservations are settled with
the provider's reported usage (Groq `usage`, Gemini `usageMetadata`).

Typical review (under 500 changed lines): 4 LLM agents × 1 call × ≈ 15K tokens = **4 requests,
≈ 60K tokens**. Groq can take at most one ≈ 3K-diff batch a minute of that; the rest fits Gemini,
whose RPM and TPM allow ≈ 3 such reviews per minute and whose RPD allows ≈ 100 per day. The worst
case (every agent needs 2 batches) is 8 requests, still under Gemini's 12 RPM. Embeddings add one
request per embedded finding: `gemini-embedding-2` has no `batchEmbedContents`, only per-item
`embedContent` and the asynchronous batch job, which is too slow for an in-review lookup.

Checked against the API on 15-Sep: `gemini-embedding-2` returns 3072 dimensions by default and 768
with `outputDimensionality: 768`, both unit-length; a one-line finding costs ≈ 15 tokens.

## Flow

```
GitHub PR files
  ▼ Gateway ─────── drop: binary, no `patch` from GitHub, generated/vendored, deleted, pure rename
  │                 → ReviewJobRequest.skippedFiles
  ▼ Orchestrator ── planLlmReview(): order (source first, smallest first), skip too_large /
  │                 over_budget, pack whole files into batches (Groq cap ≈ 3K, Gemini 12K)
  │                 per batch: Groq tryReserve() → else Gemini tryReserve() → else wait until one
  │                 fits; past the deadline → LLM agent skipped (llm_quota_exhausted)
  │                 one agent request per batch: options.llmProvider, options.deadlineMs = timeout − 2 s
  ▼ Agent ───────── skip files over maxFileTokens; stop at deadlineMs (rest over_budget);
  │                 one call per request on the assigned provider; a failed Groq call is retried
  │                 once on Gemini (fallbackDepth 1); returns provider + token counts
  ▼ Orchestrator ── settle on the provider that answered; aggregate() merges skips → report.skippedFiles + coverage
  ▼ Check Run / dashboard: "Reviewed 18 of 25 files · 7 skipped (4 too large, 3 generated)"
```

## Contract changes

- [x] `SkippedFile` in `common.yaml` with `over_budget`; `ReportSkippedFile`; `ReviewCoverage`.
- [x] `CombinedReport.skippedFiles`, `CombinedReport.coverage`; `AgentRunSummary.errorCode`
      documents `llm_quota_exhausted`.
- [x] `AgentReviewRequest.options.deadlineMs`, `Capabilities.maxFileTokens`, provider example `gemini`.
- [x] `ReviewJobRequest.skippedFiles`.
- [x] Mirror all of the above in `packages/contracts` (zod). Done 15-Sep, see
      `packages/contracts/README.md`.
- [x] `AgentReviewRequest.options.llmProvider` (`groq | gemini`) so the orchestrator tells the agent
      which quota it reserved (PR 2 of `llm-agents.md`).

## Work

### Orchestrator
- [x] `src/budget/`: `planLlmReview` with a per-provider batch cap (+ tests). `loadLlmLimits`,
      `estimateTokens` and `QuotaBudget` live in `packages/llm`.
- [x] `aggregate()` accepts `skippedFiles` + `files`; `mergeSkippedFiles`, `buildCoverage`;
      `llm_quota_exhausted` ⇒ `partial` (+ tests).
- [ ] `embedding-config.ts` pins `gemini-embedding-2`, `outputDimensionality` 768.
- [x] Fan-out: plan per LLM agent, reserve, queue until deadline, send batches with `deadlineMs`,
      settle with returned token counts. A batch is reserved just before it is sent, so a cancelled
      job holds no unsent reservation; calls aborted in flight keep their estimate.
- [x] One `QuotaBudget` each for Groq and Gemini generation, created at startup from `loadLlmLimits`
      (`createLlmRouting`).
- [ ] The Gemini embeddings budget, created with the vector-store work.

### `packages/llm`
- [x] `GroqProvider` via `fetch` (no SDK, OpenAI-compatible): strict `json_schema` output,
      `max_completion_tokens`, returns `usage`.
- [x] `GeminiProvider` via `fetch` (no SDK): `maxOutputTokens`, returns `usageMetadata`.
- [x] `InputTooLargeError` before any `fetch` when the prompt exceeds the batch budget.
- [x] Groq 429 / 5xx / network / timeout: retry once on Gemini if it fits the deadline
      (`fallbackDepth: 1`). Gemini 429: a typed quota error.
- [x] `GeminiEmbedder.embedMany()` via one `embedContent` per text, `outputDimensionality` 768, each
      request reserved against the embedding `QuotaBudget`.

### Agent kit
- [x] Skip files over `maxFileTokens` as `too_large`; advertise it in `/v1/capabilities` (`packages/agent-kit`).
- [x] Respect `options.deadlineMs`; return partial results with the rest `over_budget` (`ctx.signal`,
      `analyzePerFile`).
- [x] One LLM call per request on `options.llmProvider` (Security Agent). An LLM failure, including
      `InputTooLargeError`, is logged and the rule findings are still returned; the orchestrator's
      planner keeps batches under the input limit, so `too_large` is decided there.

### Mock agent
- [ ] `MOCK_MAX_FILE_TOKENS` skip path (+ tests).

### Gateway
- [x] File filter module (binary, missing `patch`, generated/vendored globs, deleted, pure rename).
      `services/gateway/src/webhooks/file-filter.ts`.
- [x] Send gateway skips in `ReviewJobRequest.skippedFiles`.
- [x] Paginate PR files (Octokit client, `github/octokit-github-client.ts`).
- [ ] Every file filtered ⇒ finish the review with an empty report, no orchestrator call
      (gateway already skips the orchestrator call; the empty report needs the review store).

### GitHub, dashboard, VS Code
- [ ] Check Run summary: coverage line + skipped-files list; "LLM analysis deferred" for quota skips.
- [ ] Dashboard: coverage strip, "Skipped files" section, deferred-agent state.
- [ ] VS Code: a skipped file says why instead of "no issues".

### Fixtures and tests
- [ ] Large-PR fixture: one oversized file, a lockfile, a binary, normal files.
- [ ] Staging load test: replay a burst of webhooks with the production-like limits; expect zero 429s
      from Groq and Gemini.

## Docs still to update

- [x] `class_llm.png` and `component.png` re-exported from the updated `.mmd` files.
- [x] System Design Document (§2, §3.3, §4.3, §5, Figures 2.2 and 4.3) updated and re-exported to PDF.
- Project Plan PDF is left as the original baseline; it still names the "LLM abstraction layer &
  provider fallback chain" task.
- [ ] BRD, Proposal and first status report still mention the old chain; they are submitted
      deliverables, so note the change in the next report instead. The next report must also say
      that Groq is back as the primary provider (27-Sep), with Gemini as secondary.
- [x] 27-Sep: `class_llm.mmd`, `component.mmd`, `agent.yaml`, `common.yaml` and the contracts
      comments updated for Groq primary / Gemini secondary.
- [x] System Design Document §2 and §4.3 updated for Groq primary / Gemini secondary and re-exported
      to PDF.
- [ ] System Design Document (§4.3) still names `gemini-embedding-001`; the model is now
      `gemini-embedding-2` at the same 768 dimensions. Update the `.docx` and re-export the PDF with
      the next revision, or note it in the next status report.
