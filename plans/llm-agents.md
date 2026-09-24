# Plan — LLM layer (Groq → Gemini), agent kit, Security, Style, GitHub test repo

## Status (27-Sep)

| Step | State |
| --- | --- |
| CP0 docs for the provider change | done |
| PR 1 `packages/llm` | merged (#9) |
| PR 2 orchestrator budget and routing | merged (#10) |
| PR 3 `packages/agent-kit` | merged (#11) |
| PR 4 Security Agent | merged (#12) |
| PR 5 Style Agent + sandbox | merged (#13) |
| M5 live check (verification 5) | passed after two fixes, see below |
| PR 6 real GitHub client + test repo | not started; needs the GitHub App set up first |

**M5 live check.** Gateway, orchestrator, Security and Style ran locally with the dev Groq and
Gemini keys; signed webhooks went through the gateway.

- One review: `completed` in 1.6 s; Security answered via Groq (0.9 s).
- First burst of 5: no 429, routing went Groq → Gemini as Groq's minute filled, but two Gemini
  calls were cut at the client's 15 s per-call cap (those reviews fell back to rules only), and
  Gemini reported the SQL injection 2 lines early, which showed as a second finding.
- Fixes: a Gemini call may now use the time left before the deadline (only Groq keeps the 15 s cap,
  so a fallback still has time), and an LLM finding within 3 lines of a rule finding with the same
  CWE counts as a duplicate.
- Second burst of 5: all `completed` in 2.1 s total, Groq 2 / Gemini 3, no 429, no failed LLM
  pass, no duplicate findings.

## Context

M5, the core pipeline (gateway + orchestrator + 2 agents), is due 9-Oct, and the mid-sem demo is in the week of 12-Oct. The gateway and the orchestrator HTTP layer are merged (PR #8). No agent service exists yet. The orchestrator records every agent as `skipped: agent_not_configured`.

**User decisions (27-Sep):**
- Build the LLM layer first.
- **Groq is the primary provider and Gemini the secondary.** This replaces the "Gemini only, no fallback" decision in `plans/large-diffs.md`, SDD §4.3 and memory. The Groq key is already in `services/orchestrator/.env` as `GROQ_API_KEY`.
- This plan covers the agent kit, the Security Agent and the Style Agent.

**Groq facts, from console.groq.com on 27-Sep:**
- The free tier dropped Llama on 16-Aug-2026.
- Free models: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `openai/gpt-oss-safeguard-20b` and `qwen/qwen3.8-27b`. Each gets 30 RPM, 1K RPD, **8K TPM** and 200K TPD.
- The API is OpenAI-compatible (`https://api.groq.com/openai/v1/chat/completions`).
- Strict JSON-schema output works on `gpt-oss-*` and `qwen3.8`.
- A 429 carries a `retry-after` header.

**Consequence:** at 80% headroom Groq allows about 6.4K tokens per minute, so it takes roughly **one small batch a minute**. Gemini allows 200K per minute. "Primary" therefore means: use Groq whenever its quota fits right now, otherwise use Gemini. Also fall back to Gemini when a Groq call fails (429, 5xx, timeout). Most of a busy review will still land on Gemini. Embeddings stay on Gemini, because Groq has no embedding model.

Model: `openai/gpt-oss-120b`, set by `GROQ_MODEL`.

Delivered as **6 PRs.** PRs 1–5 go in order; PR 6 (a real GitHub client for a throwaway test repo) can run in parallel.

**Checkpoints:** work stops and waits for the user to say "continue" at each of these points:
- **CP0** after the doc and memory updates for the provider change (before any code).
- **CP1–CP6** after each PR has been built, verified, pushed and its PR description handed over. The user merges; nothing is merged by Claude.
- **Before anything outward-facing:** a live LLM call with the real keys, or a force-push.

At each checkpoint the report covers what was done, the test and verification output, and what comes next.

**Where it runs:** locally for now. The user may move to the cloud at any checkpoint. Before moving:
1. Commit this plan as `plans/llm-agents.md`, with checkboxes ticked for finished PRs.
2. Put the key memory rules in the handoff summary: commit style, author = committer mapping, Groq → Gemini.
3. Remind the user to add the `GROQ_*` / `GEMINI_*` secrets to the cloud environment. PR 5 (Docker) and PR 6 (smee) stay local. Each one runs lint, build, typecheck and tests, has short commits with no trailers, and is merged with a merge commit.

---

## PR 1 — `packages/llm` (Groq + Gemini, quota budget)

Author: Sumit (LLM layer task).

- **`estimateTokens(text)`** = `ceil(bytes / 3)`, as in `large-diffs.md`.
- **`loadLlmLimits(env)`** uses zod, in the same style as `services/orchestrator/src/config.ts`:
  - Per provider: `GROQ_API_KEY`, `GROQ_MODEL` (default `openai/gpt-oss-120b`), `GROQ_RPM/TPM/RPD/TPD` (defaults 30 / 8000 / 1000 / 200000).
  - The existing `GEMINI_*` variables.
  - `LLM_QUOTA_HEADROOM` (0.8) and `LLM_MAX_OUTPUT_TOKENS` (2000).
  - Groq is enabled only when its key is set.
- **`QuotaBudget`**:
  - Tracks requests and tokens over a sliding 60 s window, and requests (plus tokens for Groq) over a rolling 24 h window. The rolling day is stricter than Gemini's midnight-Pacific reset, so it is always safe.
  - Methods: `tryReserve({ requests, tokens })` returns a `Reservation` or `{ retryAt }`; `settle(reservation, actualTokens)`; `release(reservation)`.
  - It uses an injected clock and is pure, so it is unit-tested.
- **Providers**, both on raw `fetch` (no SDK), with `AbortSignal` and `maxOutputTokens` / `max_completion_tokens`:
  - `GroqProvider` sends `response_format: { type: "json_schema", json_schema: { strict: true, ... } }` and reads `usage`.
  - `GeminiProvider` sends `generationConfig.responseMimeType: "application/json"` plus `responseSchema`, and reads `usageMetadata`.
  - Both return `LlmResponse { text, provider, model, promptTokens, completionTokens }`.
- **`LlmClient.complete(request, { provider, signal, deadlineAt })`**:
  - Throws `InputTooLargeError` before any `fetch` when the prompt exceeds the batch budget.
  - If the provider is Groq and it fails with 429 / 5xx / network / timeout, retries once on Gemini if time allows, and sets `fallbackDepth: 1`.
  - A Gemini 429 gives a typed `LlmQuotaError`.
- **`GeminiEmbedder.embedMany()`**: one `embedContent` call per text, `outputDimensionality: 768`. Built now so the vector-DB task can use it.
- Tests stub `fetch`; no key is ever used in CI.

## PR 2 — Orchestrator budget and provider routing

Author: Sumit.

- **Contract changes:** `AgentReviewRequest.options.llmProvider` (`groq | gemini`), and `AgentRunSummary.llmProvider` described as "groq, or gemini when Groq could not take it". Change `agent.yaml` / `common.yaml` first, then mirror them in `packages/contracts`.
- **`src/budget/plan.ts` — `planLlmReview(files, limits)`:**
  - Orders files source-first, then smallest first.
  - Skips `too_large` (> `LLM_MAX_FILE_TOKENS`) and `over_budget` (> `LLM_REVIEW_MAX_TOKENS` per agent).
  - Packs whole files into batches. The batch cap is per provider: Groq `min(LLM_MAX_BATCH_TOKENS, headroom·TPM − prompt reserve − max output)` ≈ 3K tokens of diff; Gemini 12K.
- **Fan-out:** the `LLM_AGENTS` are security, logic, performance and documentation; style never calls an LLM. For each LLM agent:
  - Plan the batches.
  - For each batch, reserve on Groq, else on Gemini, else wait for the earliest `retryAt` until the deadline.
  - If nothing fits before the deadline, the run is `skipped` with `llm_quota_exhausted`.
  - Send one agent request per batch with `options.llmProvider` and `deadlineMs`.
  - Merge the batch responses into one run.
  - Settle against the provider the response names. A Groq→Gemini fallback releases the Groq reservation and charges Gemini.
  - The job's abort signal releases pending reservations.
- **Startup:** `server.ts` builds one `QuotaBudget` per provider from `loadLlmLimits`. `aggregate()` gains `coverage` via `buildCoverage`.
- Tests: planner table tests, and fan-out with a fake budget (Groq full → Gemini; both full → `llm_quota_exhausted` → report `partial`).

## PR 3 — `packages/agent-kit`

Author: Parin.

Follows `class_agent.mmd`: `createAgentService(agent)` returns an Express app built on `@code-sentinel/service-kit`.

- **Move** `serviceAuthMiddleware` from `services/orchestrator/src/http/service-auth.ts` into service-kit, so the orchestrator and the agents share it.
- **Routes:**
  - `POST /v1/review` validates with `AgentReviewRequestSchema`. The body limit is `maxDiffBytes` (413).
  - `GET /v1/capabilities` and `GET /healthz` (503 + `Health` when a dependency check fails) need no auth.
- **Per-file pipeline**, owned by the kit:
  - A language the agent doesn't handle → `unsupported_language`.
  - A file over `maxFileTokens` → `too_large`.
  - Past `deadlineMs`, remaining files → `over_budget`.
  - It then calls the agent's `analyze(files, ctx)`. The context carries `llm` (an `LlmClient` when the agent uses one, plus `options.llmProvider`), `signal`, `logger` and `requestId`.
  - The response gets `serviceVersion`, `analyzedFileCount`, `latencyMs` and `llm` usage.
- **`parsePatch(patch)`** turns unified-diff hunks into added lines with new-file line numbers, plus each hunk's new-side text. Security and Style both use it.
- **`loadAgentEnv(env)`:** `PORT`, `SERVICE_TOKEN`, plus the LLM env from `packages/llm`.
- Tests use a fake agent: skips, 413, 401, deadline, `parsePatch` edge cases (`\ No newline`, multiple hunks, a deleted-only hunk).

## PR 4 — `services/security-agent` (port 8081)

Author: Tej. Covers FR-SEC-01..04.

- **Rules pass (deterministic, always runs)** over added lines only, per language (JS/TS/Python):
  - SQL injection: string-built SQL, `execute(f"…")`, template literals into `query(` (CWE-89).
  - XSS: `innerHTML =`, `dangerouslySetInnerHTML`, `document.write` (CWE-79).
  - Insecure deserialization: `pickle.loads`, `yaml.load` without `SafeLoader`, `eval` / `new Function` (CWE-502 / 95).
  - Path traversal: request data into `open` / `fs.readFile` / `path.join` (CWE-22).
  - Command injection: `subprocess(..., shell=True)`, `child_process.exec` with interpolation (CWE-78).
  - **Secrets** (CWE-798): AWS `AKIA…`, GitHub `gh[pousr]_…`, Google `AIza…`, Slack `xox…`, private-key blocks, and generic `password|secret|api_key = "<high-entropy>"`.
  - Each rule has a `ruleId`, severity, confidence and CWE, and appears in `/v1/capabilities` `rules`.
- **Secrets are never echoed:** the finding text and snippet mask the value (`AKIA****`). Detected secrets are also masked in the diff *before* it is sent to any LLM (NFR security).
- **LLM pass, only when `options.llmProvider` is set:**
  - One call per request, with a strict JSON-schema output of `{ findings: [{ ruleId, title, description, lineStart, lineEnd, severity, confidence, cweId }] }`.
  - The agent validates the model's output with zod and drops any finding whose lines are not added lines of the file.
  - If the LLM fails, the rule findings are still returned, and the error is logged; this is not a 503. A 503 happens only when the LLM was requested and the kit has no LLM configured.
- Wire `AGENT_SECURITY_URL` in `services/orchestrator/.env.example`.
- Tests: one positive and one negative fixture per rule, secret masking, and an LLM stub that returns bad JSON or out-of-range lines.

## PR 5 — `services/style-agent` (port 8082)

Author: Nevil. Covers FR-STY-01..04 and NFR-07 (no LLM).

- **Sandbox image** `services/style-agent/sandbox/Dockerfile`: `node:20-slim`, python3, and pinned `eslint` + `prettier` + `ruff` + `black`, plus a minimal ESLint flat config. Build it with `npm run sandbox:build -w @code-sentinel/style-agent`.
- **`DockerSandbox.run(files)`**: **one container per request** (FR-STY-02), started with `execFile("docker", [...])`, never a shell:
  - `--rm --network none --read-only --memory 512m --cpus 1 --pids-limit 128`
  - a tmpfs workdir with the hunk files mounted read-only
  - killed at the deadline
- **`LinterDispatcher`**, by language:
  - JS/TS: `eslint --format json` + `prettier`
  - Python: `ruff check --output-format json` + `black`
- **Input:** each hunk's new-side text from `parsePatch`, because agents never see whole files (NFR-06).
  - Diagnostics are kept only when they fall on added lines, and are mapped back to real line numbers.
  - A hunk that doesn't parse as a fragment is left out, with a count in the log.
- **Fixes:** when the formatter or `ruff --fix` changes an added block, the agent returns a `suggestion { kind: "deterministic", originalSnippet, suggestedSnippet }` (FR-STY-03). Anything it can't fix is reported as a normal finding (FR-STY-04).
- **Health:** `docker image inspect` on the sandbox image. If the image is missing or Docker is down, the agent answers 503 with `checks.sandbox`.
- **Deployment (noted for later):** the container needs the Docker socket. That goes into the deployment task, not this PR.

## PR 6 — Real GitHub client + throwaway test repo

Author: Vatsal (GitHub App task). This PR doesn't depend on the agents and can be built alongside PRs 3–5.

**What you set up once.** I can't do these steps: `gh` isn't installed here, and each step creates something on your GitHub account.
1. Create a throwaway repo, e.g. `sumit-0804/code-sentinel-playground`, containing a few JS and Python files.
2. Register a GitHub App (Settings → Developer settings → GitHub Apps):
   - Permissions: *Pull requests: read*, *Contents: read*, *Metadata: read*, and *Checks: write* for later.
   - Events: *Pull request*.
   - Webhook URL: a new https://smee.io channel.
   - Webhook secret: the value of `GITHUB_WEBHOOK_SECRET`.
3. Install the app on the playground repo only, and download its private key to `services/gateway/github-app.pem`, which is gitignored.

**Code:**
- `github/octokit-github-client.ts` implements the existing `GitHubClient` interface (`services/gateway/src/github/github-client.ts`) with `@octokit/app`. It uses installation tokens and `paginate` for PR files, which closes the "Paginate PR files" item in `large-diffs.md`.
- Config:
  - New settings: `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY_PATH`.
  - When both are set, `server.ts` uses Octokit; otherwise it keeps `StubGitHubClient`.
  - In production, both are required.
- Dev seed: `GATEWAY_DEV_REPOSITORY=<owner/name>:<githubRepoId>` points the seeded repository at the playground repo instead of the fake id 123456789. This is needed until PostgreSQL stores land.
- Local tunnel: `npx smee-client --url <channel> --target http://127.0.0.1:3000/webhooks/github`. The step is documented in the gateway README; nothing is added to the repo.
- Tests: the Octokit client runs against a stubbed `fetch` (pagination and the `removed` / `renamed` fields), and config covers the Octokit-vs-stub choice.

---

## Docs (updated in the PR that changes them)

- `plans/large-diffs.md`: Groq primary, the budget table per provider, Groq's 8K TPM and batch cap, and routing.
- `docs/design/openapi/agent.yaml` and `common.yaml` (`llmProvider`, `fallbackDepth` = 1 when Gemini took over, 503 text).
- `class_llm.mmd`, `component.mmd` and `class_agent.mmd` (LlmClient → Groq + Gemini). Re-render the PNGs with `docs/design/build/render_mermaid.py`.
- SDD `.docx` §2 / §4.3, then re-export the PDF.
- Service READMEs, `.env.example` files and the root README layout. A line for the next status report about the provider change.
- Memory: replace `llm-providers-prod-vs-dev.md` (Gemini only) with Groq primary + Gemini secondary.

## Authors

- Author mapping comes from memory `commit-author-on-behalf`.
- **Committer = author on every commit**, so GitHub shows only one name. Each commit is made with `GIT_AUTHOR_NAME/EMAIL` and `GIT_COMMITTER_NAME/EMAIL` both set to the teammate, e.g. `GIT_COMMITTER_NAME="Tejprakash01" GIT_COMMITTER_EMAIL="<noreply>" git commit --author="Tejprakash01 <noreply>" -m "..."`. Your own commits stay `sumit-0804 <sumitg2004@gmail.com>` for both. Before pushing, check with `git log --format='%an | %cn'`. No re-authoring after a push, so no force-push is needed.
- Update memory `commit-author-on-behalf` to say the committer is always set to the author.
- Before the first commit of PRs 3–5, look up the noreply emails for `parinbajayebin`, `Tejprakash01` and `Nevil-Nandasana` from `api.github.com/users/<login>`, then save them to memory.

## Verification

1. Every PR: `npm run lint && npm run build && npm run typecheck && npm run test` passes at the root.
2. PR 1: a single live call per provider with the dev keys, using a tiny prompt (one request each, well under quota), to confirm the JSON-schema output and the token counts.
3. PR 4: start the security agent, then `POST /v1/review` with the example SQL-injection diff. Expect `security/sql-injection` (CWE-89) and a masked secret.
4. PR 5: build the sandbox image. A JS diff with `var x = 1;;` and bad spacing should give an ESLint finding plus a deterministic Prettier fix. Confirm `--network none` by checking `docker inspect` while it runs.
5. **M5 end to end:** run the gateway, orchestrator, security agent and style agent together, then send the signed webhook from the gateway README.
   - The job should end `completed`.
   - Findings should come from both agents.
   - `agentRuns[security].llmProvider` should be `groq`, or `gemini` under load.
   - A burst of 5 webhooks should produce no 429 in the logs.
6. **Real test repo** (after PR 6): with smee forwarding to the local gateway, open a PR on the playground repo that adds `execute(f"SELECT … {id}")` and a badly formatted JS file.
   - The gateway log should show `review_started`, fetching the real PR files.
   - The orchestrator job should end with security and style findings for those lines.
   - Pushing another commit gives a new job. Redelivering from the App's "Recent deliveries" page gives `duplicate_ignored`.
