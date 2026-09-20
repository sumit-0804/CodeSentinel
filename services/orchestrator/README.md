# @code-sentinel/orchestrator

The LangGraph orchestrator. It fans a review request out to the enabled agent services in
parallel, applies the per-agent timeout, then **aggregates, de-duplicates and severity-ranks**
the findings and attaches similar past issues before returning one combined report
(FR-ORC-01…06).

Contract: [`docs/design/openapi/orchestrator.yaml`](../../docs/design/openapi/orchestrator.yaml).
Agent contract it calls: [`docs/design/openapi/agent.yaml`](../../docs/design/openapi/agent.yaml).
Class design: [`docs/design/diagrams/mermaid/class_orchestrator.mmd`](../../docs/design/diagrams/mermaid/class_orchestrator.mmd).
Shared types and validators: [`@code-sentinel/contracts`](../../packages/contracts/README.md). The
orchestrator no longer defines `Finding`, `CombinedReport` and friends itself; import them from
there.

## What's scaffolded so far

| Area | Module | Status |
| --- | --- | --- |
| HTTP server (`orchestrator.yaml`) | `app.ts`, `server.ts`, `routes/` | working |
| Service-token auth on `/internal/*` | `http/service-auth.ts` | working |
| `ReviewJobController` (create, poll, cancel, idempotency) | `jobs/review-job-controller.ts` | working |
| Job store | `jobs/job-store.ts` | in-memory, finished jobs dropped after `JOB_RETENTION_MS` |
| Config from env, validated at startup | `config.ts`, `agents/agent-config.ts` | working |
| Review graph (`ReviewGraph`, `ReviewState`) | `graph/review-graph.ts`, `graph/review-state.ts` | working |
| Parallel fan-out + timeout (FR-ORC-01/02, NFR-02/04) | `graph/fan-out-node.ts` | working |
| Agent HTTP client (NFR-12 request id) | `agents/agent-client.ts`, `agents/agent-call-error.ts` | working |
| Agent config from env | `agents/agent-config.ts` | working |
| Aggregate node | `graph/aggregate-node.ts` | working |
| De-duplication (FR-ORC-03) | `aggregation/finding-aggregator.ts` | working |
| Severity ranking (FR-ORC-04) | `aggregation/severity-ranker.ts` | working |
| Summary counts | `aggregation/review-summary.ts` | working |
| Review status from runs | `aggregation/index.ts` → `deriveStatus()` | working |
| Skipped-file merge | `aggregation/skipped-files.ts` → `mergeSkippedFiles()` | working |
| Aggregate step | `aggregation/index.ts` → `aggregate()` | working |
| `ContextNode` (FR-ORC-05) | `graph/context-node.ts`, `context/similar-issue-lookup.ts` | wired, thin: no-op until a `VectorRepository` is supplied |
| `ThresholdNode` (FR-ORC-06) | `graph/threshold-node.ts` | wired, thin: records `confidenceThreshold` on the report only |
| Vector store (FR-VDB-01/02) | `context/vector-repository.ts` | interface + Chroma stub |
| LLM batch planning (`planLlmReview`) | `budget/plan.ts` | working |
| Groq → Gemini quota routing (one `QuotaBudget` per provider) | `budget/llm-routing.ts` | working |
| Review coverage | `aggregation/coverage.ts` → `buildCoverage()` | working |

## HTTP API

Only the gateway calls the orchestrator. Every `/internal/v1` route needs
`Authorization: Bearer <SERVICE_TOKEN>`. Logging, request ids and `ApiError` bodies come from
[`@code-sentinel/service-kit`](../../packages/service-kit/README.md).

| Route | Answer |
| --- | --- |
| `POST /internal/v1/review-jobs` | 202 + `ReviewJob` (`queued`), and the review runs in the background. 200 + the existing job when `Idempotency-Key` was seen before. 400 `invalid_body` / `invalid_header`, 422 `no_agents_enabled` when `enabledAgents` is empty |
| `GET /internal/v1/review-jobs/{jobId}` | 200 + `ReviewJob`: `running`, then `completed` / `partial` / `failed` with `report` and `agentRuns`. 404 `not_found` |
| `POST /internal/v1/review-jobs/{jobId}/cancel` | 200 + `cancelled` job; aborts every agent call in flight. A finished job is returned unchanged. 404 `not_found` |
| `GET /internal/v1/agents/health` | Each agent's `/healthz`, polled on demand (2 s per agent) and cached 30 s. An agent with no URL or no answer is `unavailable` |
| `GET /healthz` | `{ status: "ok", version }`, no token needed |
| missing or wrong token | 401 `unauthenticated` / `invalid_credentials` |

A job's status follows the report's (see the status rules below). A run that throws is `failed` with
`error.code: internal_error`, and the error is logged. A cancel always wins: a run that finishes
after its job was cancelled does not overwrite it. `X-Request-Id` from the gateway is forwarded to
every agent call, and the request log line carries `jobId`, `reviewId` and `created`.

## Graph

```text
START → fanOut → aggregate → context → threshold → END
```

`buildReviewGraph({ clients, similarIssueLookup? })` compiles the graph and returns `{ graph, run }`.
`run({ reviewId, requestId?, request }, { signal? })` takes a `ReviewJobRequest`, builds the initial state with
`toInitialState()` (all five agents and a 0.8 threshold when the job omits them) and resolves to
the `CombinedReport`.

| Node | Reads from `ReviewState` | Writes |
| --- | --- | --- |
| `fanOut` | `reviewId`, `files`, `enabledAgents`, `confidenceThreshold`, `agentTimeoutMs`, `requestId` | appends `rawFindings`, `agentRuns`, `agentSkippedFiles` |
| `aggregate` | `rawFindings`, `agentRuns`, `files`, `gatewaySkippedFiles`, `agentSkippedFiles` | `report` (deduped, ranked, status, `skippedFiles`, `coverage`) |
| `context` | `report`, `organizationId`, `includeSimilarPastIssues` | `report.findings[].similarPastIssues` |
| `threshold` | `report`, `confidenceThreshold` | `report.confidenceThreshold` |

`fanOut` calls every enabled agent at once; a failing agent never fails the review. Each call gets
`options.deadlineMs = timeout − 2000` so the agent can return what it has before the orchestrator
abandons it. How an agent is called depends on whether it uses an LLM (see **LLM routing** below):
the Style Agent, and every agent when no LLM key is configured, get one request with all files. The run's abort `signal` is passed to every call, so cancelling a job
stops its agents. Responses are validated against `AgentReviewResponseSchema`, and the
orchestrator-owned finding fields (`id`, `similarPastIssues`, `duplicateCount`) are stripped.

`threshold` does not filter findings: `CombinedReport` has no per-finding "postable" flag, so the
gateway applies the recorded threshold when it posts suggestions.

**Status rules** (`deriveStatus`, per `state_review.mmd`):

| Agent runs | `report.status` |
| --- | --- |
| every run `succeeded` (runs `skipped` for a missing URL are ignored) | `completed` |
| at least one `succeeded`, at least one `timed_out`, `failed` or `llm_quota_exhausted` | `partial` |
| no run `succeeded` (including no runs at all) | `failed` |

**Run-summary `errorCode` values:**

| `errorCode` | `status` | Cause |
| --- | --- | --- |
| `agent_not_configured` | `skipped` | Agent is enabled but its URL env var is unset |
| `llm_quota_exhausted` | `skipped`, or `succeeded` when some batches were sent | Neither Groq nor Gemini had quota before the deadline; the unsent files are `over_budget` |
| `no_reviewable_files` | `skipped` | Every file was `too_large` or `over_budget` for the LLM agent |
| `agent_timeout` | `timed_out` | No answer within `agentTimeoutMs` |
| `http_<status>` | `failed` | Non-2xx response, e.g. `http_503` when no LLM provider could answer |
| `invalid_response` | `failed` | Body is not JSON, fails the schema, or names another agent |
| `network_error` | `failed` | Connection refused, DNS failure, reset |
| `unexpected_error` | `failed` | Anything else thrown while calling the agent |

`report.skippedFiles` has one entry per path and reason: gateway skips first (no `agents`), then
agent skips listing every agent that skipped that file for that reason.

`report.coverage` counts a file as reviewed when at least one agent that succeeded did not skip it.
Changed lines are the `+` / `-` lines of each patch; gateway-dropped files count toward
`filesTotal` but have no patch, so they add no lines.

## LLM routing

Groq is the primary provider and Gemini the secondary ([`plans/large-diffs.md`](../../plans/large-diffs.md)).
The orchestrator never calls an LLM itself; it decides which provider's quota each agent request
may use, so production never receives a 429. At startup `loadLlmLimits()` reads the keys and
limits and `createLlmRouting()` builds one `QuotaBudget` per configured provider, shared by every
review in the process.

For each LLM agent (security, performance, logic, documentation):

1. **Timeout** is `max(job.agentTimeoutMs, LLM_AGENT_TIMEOUT_MS)`: 45 s by default, because a
   Gemini call took 22 s on the free tier on 27-Sep.
2. **Plan** (`planLlmReview`): source files first, then smallest first; a file over
   `LLM_MAX_FILE_TOKENS` is `too_large`, anything past `LLM_REVIEW_MAX_TOKENS` is `over_budget`,
   and the rest is packed into batches of up to `LLM_MAX_BATCH_TOKENS`.
3. **Reserve** each batch (`reserveBatch`), costing diff tokens + prompt reserve + max output: on
   Groq when the batch fits one Groq call (about 3.4K diff tokens at 8K TPM) and Groq has room now,
   otherwise on Gemini, otherwise wait for the first to free up. If nothing frees up at least 5 s
   before the deadline, the rest of the agent's files are `over_budget` and the run carries
   `llm_quota_exhausted`.
4. **Send** each reserved batch at once with `options.llmProvider`, then **settle**
   (`settleCall`) with the agent's reported token counts: a call that made no LLM request gives its
   reservation back, and a Groq call Gemini answered is charged to Gemini. A failed call keeps its
   estimate.
5. **Merge** the batches into one run. `llmProvider` is `groq`, `gemini` or `groq,gemini`. If any
   batch failed, the run takes that failure's status but keeps the other batches' findings.

Without any LLM key the orchestrator logs a warning and LLM agents get one request with no
`llmProvider`, so they run their rule-based checks only.

## Configuration

`server.ts` loads `.env` (or `.env.production` when `NODE_ENV=production`) from
`services/orchestrator/`; variables already set in the process win. `loadOrchestratorConfig()` reads
the HTTP settings and reports every invalid one at once. `loadAgentConfig()` reads the agents, and
`createAgentClients()` builds one `AgentClient` per agent with a URL. Either failing exits with code
1. See [`.env.example`](.env.example).

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Listen port, integer 1..65535 |
| `JOB_RETENTION_MS` | `3600000` | How long a finished job stays readable, integer 60000..86400000 |
| `LLM_AGENT_TIMEOUT_MS` | `45000` | Minimum timeout for LLM agents, integer 1000..120000 |
| `GROQ_*`, `GEMINI_*`, `LLM_*` | see [`packages/llm`](../../packages/llm/README.md) | Provider keys and limits of **this environment's** keys, and the batch sizes |
| `AGENT_SECURITY_URL` | unset | Security agent base URL |
| `AGENT_STYLE_URL` | unset | Style agent base URL |
| `AGENT_PERFORMANCE_URL` | unset | Performance agent base URL |
| `AGENT_LOGIC_URL` | unset | Logic agent base URL |
| `AGENT_DOCUMENTATION_URL` | unset | Documentation agent base URL |
| `SERVICE_TOKEN` | required | Expected from the gateway on `/internal/*` and sent to every agent as `Authorization: Bearer <token>`. Same value as the gateway's |
| `AGENT_TIMEOUT_MS` | `20000` | Client default timeout, integer in 1000..120000; anything else throws at startup. A job's `agentTimeoutMs` overrides it per review |

An unset agent URL is not an error: that agent is recorded as `skipped` when a job enables it.

## Not started yet

- `callbackUrl`: accepted but not called yet (a warning is logged); the gateway polls instead
- `agentRuns` while a job is running: they appear only once the job finishes
- `ReviewRepository` (PostgreSQL persistence), replacing the in-memory job store
- Chroma `VectorRepository` implementation
- Gemini embeddings into the vector store (`GeminiEmbedder` exists in `packages/llm`)

## Develop

```bash
npm install                                  # from the repo root
npm run test                                 # Turborepo builds contracts and service-kit first, then runs every test
npm run test  -w @code-sentinel/orchestrator # needs a prior build of contracts, service-kit and llm
npm run build -w @code-sentinel/orchestrator
npm run start -w @code-sentinel/orchestrator # after a build; reads services/orchestrator/.env
```

Tests stub `fetch` through the `AgentClient` constructor and run the HTTP app on an ephemeral port
(`withServer`), so no agent service needs to be running.

**Manual check** (Git Bash, from `services/orchestrator/` after `npm run build` at the root):

1. Start with no agents: `PORT=8080 SERVICE_TOKEN=local-service-token AGENT_SECURITY_URL= AGENT_STYLE_URL= AGENT_PERFORMANCE_URL= AGENT_LOGIC_URL= AGENT_DOCUMENTATION_URL= node dist/server.js`.
2. `POST /internal/v1/review-jobs` with the bearer token, `Idempotency-Key: smoke-1` and
   `exampleReviewJobRequest` from `@code-sentinel/contracts/examples` as the body: 202 `queued`.
3. `GET /internal/v1/review-jobs/{jobId}`: `failed`, every enabled agent `skipped` with
   `agent_not_configured` (expected with no agents). Repeat step 2: 200, same `jobId`.
4. Without the token: 401 `unauthenticated`.
5. End to end: start the gateway with `ORCHESTRATOR_URL=http://127.0.0.1:8080`, the same
   `SERVICE_TOKEN` and `GATEWAY_SEED=dev`, then send the signed webhook from the gateway README's
   manual check. The first delivery is `review_started`, and a redelivery is `duplicate_ignored`
   with the same `reviewId`.
