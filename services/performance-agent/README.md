# @code-sentinel/performance-agent

The Performance Agent (FR-PERF-01/02). It reads each changed file **whole** and reports slow
code that the pull request's **added lines** introduce:
- N+1 queries: a query or HTTP call per loop item, including one hidden behind a helper
- blocking I/O or sleeps on async paths and request handlers
- quadratic lookups in loops
- expensive work repeated in loops, such as regex compiles, JSON deep clones and sorting
- missing batching or pagination

Built on [`@code-sentinel/agent-kit`](../../packages/agent-kit/README.md), so it speaks
[`agent.yaml`](../../docs/design/openapi/agent.yaml) like every agent.

## How a request is analyzed

It has no rules: one LLM call per request through agent-kit's `runLlmPass`. The orchestrator gives
LLM agents at least `LLM_AGENT_TIMEOUT_MS` (45 s), well inside FR-PERF-02's per-agent timeout for
typical diffs.

1. **What the model sees:** each file numbered line by line with `+` on the added lines, so it
   knows the new loop calls `load_order()` and that `load_order()` runs a query. Files linked by
   imports share the call, and the PR's other changed files follow as context (`otherChanges`).
2. **What is kept:** findings that start on an added line of a file in the request, `ruleId`
   prefixed `performance/`, no CWE, and an AI fix only when every replaced line was added by
   this PR.
3. **Failure:** no LLM answer means no result: **503 `llm_failed`** (or `llm_unavailable` without
   a key), shown as a failed run.

## Configuration

See [`.env.example`](.env.example): `PORT` (default 8083), `SERVICE_TOKEN`, and the `GROQ_*` /
`GEMINI_*` / `LLM_*` variables. The batch sizes must match the orchestrator's. This agent can use
its own Groq account's key, named in the orchestrator's `GROQ_ACCOUNT_PERFORMANCE`.

## Develop

```bash
npm run build -w @code-sentinel/performance-agent
npm run start -w @code-sentinel/performance-agent   # reads services/performance-agent/.env
npm run test  -w @code-sentinel/performance-agent
```

**Manual check:** start it, then `POST /v1/review` on port 8083 as in the
[Logic Agent README](../logic-agent/README.md#develop), with a file whose added loop calls a
query helper defined above it. Expect a `performance/…` finding on the loop line.
