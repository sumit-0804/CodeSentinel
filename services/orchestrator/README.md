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

## Graph

```text
START → fanOut → aggregate → context → threshold → END
```

`buildReviewGraph({ clients, similarIssueLookup? })` compiles the graph and returns `{ graph, run }`.
`run({ reviewId, requestId?, request })` takes a `ReviewJobRequest`, builds the initial state with
`toInitialState()` (all five agents and a 0.8 threshold when the job omits them) and resolves to
the `CombinedReport`.

| Node | Reads from `ReviewState` | Writes |
| --- | --- | --- |
| `fanOut` | `reviewId`, `files`, `enabledAgents`, `confidenceThreshold`, `agentTimeoutMs`, `requestId` | appends `rawFindings`, `agentRuns`, `agentSkippedFiles` |
| `aggregate` | `rawFindings`, `agentRuns`, `gatewaySkippedFiles`, `agentSkippedFiles` | `report` (deduped, ranked, status, `skippedFiles`) |
| `context` | `report`, `organizationId`, `includeSimilarPastIssues` | `report.findings[].similarPastIssues` |
| `threshold` | `report`, `confidenceThreshold` | `report.confidenceThreshold` |

`fanOut` calls every enabled agent at once with `Promise.allSettled`. Each call gets
`options.deadlineMs = agentTimeoutMs − 2000` so the agent can return what it has before the
orchestrator abandons it. Responses are validated against `AgentReviewResponseSchema`, and the
orchestrator-owned finding fields (`id`, `similarPastIssues`, `duplicateCount`) are stripped.

`threshold` does not filter findings: `CombinedReport` has no per-finding "postable" flag, so the
gateway applies the recorded threshold when it posts suggestions.

**Status rules** (`deriveStatus`, per `state_review.mmd`):

| Agent runs | `report.status` |
| --- | --- |
| every run `succeeded` (runs `skipped` for a missing URL are ignored) | `completed` |
| at least one `succeeded`, at least one `timed_out` or `failed` | `partial` |
| no run `succeeded` (including no runs at all) | `failed` |

**Run-summary `errorCode` values:**

| `errorCode` | `status` | Cause |
| --- | --- | --- |
| `agent_not_configured` | `skipped` | Agent is enabled but its URL env var is unset |
| `agent_timeout` | `timed_out` | No answer within `agentTimeoutMs` |
| `http_<status>` | `failed` | Non-2xx response, e.g. `http_503` when Gemini is unavailable |
| `invalid_response` | `failed` | Body is not JSON, fails the schema, or names another agent |
| `network_error` | `failed` | Connection refused, DNS failure, reset |
| `unexpected_error` | `failed` | Anything else thrown while calling the agent |

`report.skippedFiles` has one entry per path and reason: gateway skips first (no `agents`), then
agent skips listing every agent that skipped that file for that reason.

## Configuration

Read by `loadAgentConfig()`; `createAgentClients()` builds one `AgentClient` per agent with a URL.
See [`.env.example`](.env.example).

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGENT_SECURITY_URL` | unset | Security agent base URL |
| `AGENT_STYLE_URL` | unset | Style agent base URL |
| `AGENT_PERFORMANCE_URL` | unset | Performance agent base URL |
| `AGENT_LOGIC_URL` | unset | Logic agent base URL |
| `AGENT_DOCUMENTATION_URL` | unset | Documentation agent base URL |
| `SERVICE_TOKEN` | unset | Sent as `Authorization: Bearer <token>`; omitted when unset |
| `AGENT_TIMEOUT_MS` | `20000` | Client default timeout, integer in 1000..120000; anything else throws at startup. A job's `agentTimeoutMs` overrides it per review |

An unset agent URL is not an error: that agent is recorded as `skipped` when a job enables it.

## Not started yet

- `ReviewJobController` + HTTP server (`/internal/v1/review-jobs`), in-memory job store,
  idempotency, and cancel (the client already accepts an abort `signal`)
- `src/budget/` Gemini quota planning and batching (see [`plans/large-diffs.md`](../../plans/large-diffs.md))
- `coverage` on the combined report (needs changed-line counting from the budget step)
- `ReviewRepository` (PostgreSQL persistence)
- Chroma `VectorRepository` implementation
- `packages/llm` Gemini client

## Develop

```bash
npm install                                  # from the repo root
npm run test                                 # Turborepo builds contracts first, then runs every test
npm run test  -w @code-sentinel/orchestrator # needs a prior `npm run build -w @code-sentinel/contracts`
npm run build -w @code-sentinel/orchestrator
```

Tests stub `fetch` through the `AgentClient` constructor, so no agent service needs to be running.
