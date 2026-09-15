# Plan — Large diffs and Gemini quota (cross-cutting)

Written 15-Sep-2026.

## Decisions

- **Large diffs are skipped, never split.** A file is reviewed whole if it fits the limits;
  otherwise it is listed as skipped in the report.
- **Gemini is the only LLM provider**, for review calls (Gemini 3.5 Flash Lite) and embeddings.
  No OpenRouter, Groq or Ollama.
- **Separate `GEMINI_API_KEY` for development and production.** Each key has its own quota, so each
  environment sets its own `GEMINI_RPM/TPM/RPD`. CI and unit tests stub `fetch` and never use a key.
- **Production must never receive a 429.** The orchestrator reserves quota before fan-out; retrying
  after a 429 is only a last guard.
- Skipped files alone never make a review `partial`. An LLM agent deferred because the quota could
  not fit it before the deadline does (`skipped` + `errorCode: llm_quota_exhausted`).

## Budget

Gemini 3.5 Flash Lite free tier (AI Studio): 15 RPM, 250K TPM, 500 RPD. We use 80%: 12 RPM,
200K TPM, 400 RPD. The daily window resets at midnight Pacific.

| Env var | Default | Meaning |
| --- | --- | --- |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Review model (confirm the id in AI Studio) |
| `GEMINI_RPM` / `GEMINI_TPM` / `GEMINI_RPD` | 15 / 250000 / 500 | Limits of **this environment's** key |
| `LLM_QUOTA_HEADROOM` | 0.8 | Share of each limit we use |
| `LLM_MAX_FILE_TOKENS` | 6000 | Larger file ⇒ `too_large` |
| `LLM_MAX_BATCH_TOKENS` | 12000 | Diff tokens per Gemini call (≈ 36 KB, ≈ 900 changed lines) |
| `LLM_REVIEW_MAX_TOKENS` | 24000 | Diff tokens per LLM agent per review; the rest ⇒ `over_budget` |
| `LLM_PROMPT_RESERVE_TOKENS` | 1000 | System prompt per call |
| `LLM_MAX_OUTPUT_TOKENS` | 2000 | Sent as `maxOutputTokens`; counts against TPM |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` | 768 dims, L2-normalised (`embedding-config.ts`) |
| `GEMINI_EMBED_RPM` / `TPM` / `RPD` | placeholders | **Copy the real values from the AI Studio quota page** |

Tokens are estimated as `ceil(bytes / 3)` (pessimistic, no tokenizer); reservations are settled with
Gemini's `usageMetadata`.

Typical review (under 500 changed lines): 4 LLM agents × 1 call × ≈ 15K tokens = **4 requests,
≈ 60K tokens**. RPM and TPM both allow ≈ 3 such reviews per minute; RPD allows ≈ 100 per day. The
worst case (every agent needs 2 batches) is 8 requests, still under 12 RPM. Embeddings add one
batch request per review.

## Flow

```
GitHub PR files
  ▼ Gateway ─────── drop: binary, no `patch` from GitHub, generated/vendored, deleted, pure rename
  │                 → ReviewJobRequest.skippedFiles
  ▼ Orchestrator ── planLlmReview(): order (source first, smallest first), skip too_large /
  │                 over_budget, pack whole files into batches
  │                 QuotaBudget.tryReserve(requests, tokens) → wait in queue until it fits;
  │                 past the deadline → LLM agents skipped (llm_quota_exhausted)
  │                 one agent request per batch, options.deadlineMs = timeout − 2 s
  ▼ Agent ───────── skip files over maxFileTokens; stop at deadlineMs (rest over_budget);
  │                 one Gemini call per request; returns token counts
  ▼ Orchestrator ── QuotaBudget.settle(); aggregate() merges skips → report.skippedFiles + coverage
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

## Work

### Orchestrator
- [ ] `src/budget/`: `loadLlmLimits`, `estimateTokens`, `planLlmReview`, `QuotaBudget` (+ tests).
- [ ] `aggregate()` accepts `skippedFiles` + `files`; `mergeSkippedFiles`, `buildCoverage`;
      `llm_quota_exhausted` ⇒ `partial` (+ tests).
- [ ] `embedding-config.ts` pins `gemini-embedding-001`, 768 dims.
- [ ] Fan-out: plan per LLM agent, reserve, queue until deadline, send batches with `deadlineMs`,
      settle with returned token counts, release on cancel.
- [ ] One `QuotaBudget` for generation and one for embeddings, created at startup from `loadLlmLimits`.

### `packages/llm`
- [ ] `GeminiProvider` via `fetch` (no SDK): `maxOutputTokens`, returns `usageMetadata`.
- [ ] `InputTooLargeError` before any `fetch` when the prompt exceeds the batch budget.
- [ ] On 429: read the retry delay, retry once only if it fits the deadline, else a typed quota error.
- [ ] `GeminiEmbedder.embedMany()` via `batchEmbedContents`, `outputDimensionality` 768, normalised.

### Agent kit
- [ ] Skip files over `maxFileTokens` as `too_large`; advertise it in `/v1/capabilities`.
- [ ] Respect `options.deadlineMs`; return partial results with the rest `over_budget`.
- [ ] One Gemini call per request for LLM agents; map `InputTooLargeError` to `too_large`.

### Mock agent
- [ ] `MOCK_MAX_FILE_TOKENS` skip path (+ tests).

### Gateway
- [x] File filter module (binary, missing `patch`, generated/vendored globs, deleted, pure rename).
      `services/gateway/src/webhooks/file-filter.ts`.
- [x] Send gateway skips in `ReviewJobRequest.skippedFiles`.
- [ ] Paginate PR files (Octokit client).
- [ ] Every file filtered ⇒ finish the review with an empty report, no orchestrator call
      (gateway already skips the orchestrator call; the empty report needs the review store).

### GitHub, dashboard, VS Code
- [ ] Check Run summary: coverage line + skipped-files list; "LLM analysis deferred" for quota skips.
- [ ] Dashboard: coverage strip, "Skipped files" section, deferred-agent state.
- [ ] VS Code: a skipped file says why instead of "no issues".

### Fixtures and tests
- [ ] Large-PR fixture: one oversized file, a lockfile, a binary, normal files.
- [ ] Staging load test: replay a burst of webhooks with the production-like limits; expect zero 429s.

## Docs still to update

- [x] `class_llm.png` and `component.png` re-exported from the updated `.mmd` files.
- [x] System Design Document (§2, §3.3, §4.3, §5, Figures 2.2 and 4.3) updated and re-exported to PDF.
- Project Plan PDF is left as the original baseline; it still names the "LLM abstraction layer &
  provider fallback chain" task.
- [ ] BRD, Proposal and first status report still mention the old chain; they are submitted
      deliverables, so note the change in the next report instead.
