# @code-sentinel/agent-kit

The shared base of the five agent services (`BaseAgentService` in
[`class_agent.mmd`](../../docs/design/diagrams/mermaid/class_agent.mmd)). An agent describes
itself and supplies `analyze`; the kit owns the HTTP contract in
[`agent.yaml`](../../docs/design/openapi/agent.yaml), request validation, the per-file skips, the
deadline and the response check, so all five agents behave the same (FR-SEC-04, NFR-10).

## Writing an agent

```ts
import { analyzePerFile, parsePatch, startAgentService, type ReviewAgent } from "@code-sentinel/agent-kit";

const agent: ReviewAgent = {
  kind: "security",
  version: "1.0.0",
  languages: ["python", "javascript", "typescript"],
  usesLlm: true,
  maxDiffBytes: 1_000_000,
  maxFileTokens: 6000,
  async analyze(files, ctx) {
    const { results, skipped } = await analyzePerFile(files, ctx, (file) => scan(parsePatch(file.patch)));
    return { findings: results, skipped };
  },
};

startAgentService(agent, { defaultPort: 8081, serviceDir: fileURLToPath(new URL("..", import.meta.url)) });
```

## What the kit does

| Route | Behaviour |
| --- | --- |
| `POST /v1/review` | Bearer `SERVICE_TOKEN` required (401). Body over `maxDiffBytes` → 413 `payload_too_large`; invalid body → 400 `invalid_body`. `options.llmProvider` set but that provider has no key here → 503 `llm_unavailable`. Otherwise 200 with an `AgentReviewResponse` |
| `GET /v1/capabilities` | `agent`, `version`, `languages`, `usesLlm`, `producesDeterministicFixes`, `maxDiffBytes`, `maxFileTokens`, `rules`; no token needed |
| `GET /healthz` | `ok`, `degraded` (an LLM agent without a key) or `unavailable` (a check from `agent.health()` failed, answered with 503) |

`runReview()` is the pipeline behind `POST /v1/review`:

1. A file whose language (per-file, else the request's `language`) the agent does not support is
   `unsupported_language`; a patch over `maxFileTokens` (bytes / 3) is `too_large`.
2. `analyze(files, ctx)` runs **once** with the rest. `ctx.signal` fires at `options.deadlineMs` or
   when the orchestrator hangs up; `ctx.llm` is `{ client, provider }` only when the orchestrator
   reserved quota (`options.llmProvider`) and this agent has that key.
3. The response gets `agent` on every finding, `serviceVersion`, `analyzedFileCount`, the kit's
   and the agent's `skippedFiles`, `llm` usage and `latencyMs`, and must pass
   `AgentReviewResponseSchema`. An agent that breaks the contract answers 500, not a bad body.

Helpers:

- `analyzePerFile(files, ctx, fn)`: runs `fn` per file until `ctx.signal` fires and lists the
  unreached files as `over_budget`.
- `parsePatch(patch)`: unified diff → hunks with new-side line numbers, and every added line.
  Agents see hunks, never whole files (NFR-06), so findings must point at added lines.
  `hunkText(hunk)` gives a hunk's new side as source text.
- `loadAgentEnv(env, { defaultPort, usesLlm })`: `PORT`, `SERVICE_TOKEN` (required), and for LLM
  agents an `LlmClient` from the `GROQ_*` / `GEMINI_*` variables
  ([`packages/llm`](../llm/README.md)). Every bad variable is reported at once.
- `startAgentService(agent, { defaultPort, serviceDir })`: the whole `server.ts` of an agent —
  loads `.env` / `.env.production`, validates config, listens, shuts down on SIGTERM / SIGINT. An
  LLM agent without a key logs a warning and runs its rule-based checks only.

## Develop

```bash
npm run test  -w @code-sentinel/agent-kit
npm run build -w @code-sentinel/agent-kit
```
