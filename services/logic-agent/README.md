# @code-sentinel/logic-agent

The Logic Agent (FR-LOG-01/02). It reads each changed file **whole** and reports bugs that the
pull request's **added lines** introduce or expose: missing null / None / undefined checks,
off-by-one errors, unhandled exceptions and promise rejections, swallowed errors, inverted or
impossible conditions, and functions used against what they now return. Built on
[`@code-sentinel/agent-kit`](../../packages/agent-kit/README.md), so it speaks
[`agent.yaml`](../../docs/design/openapi/agent.yaml) like every agent.

## How a request is analyzed

It has no rules: the work is one LLM call per request through agent-kit's `runLlmPass` and the
shared LLM layer, so a Groq failure falls back to Gemini (FR-LOG-02).

1. **What the model sees:** each file numbered line by line, with `+` on the lines this PR added
   (`ChangedFile.content`). A bug usually depends on code around the change, such as a helper
   above that can return `None`. Files linked by imports come in the same call, and the PR's
   other changed files follow as context (`otherChanges`), so a changed return value in
   `utils.py` is seen when reviewing its caller in `views.py`. A file sent without its whole text
   is shown as its hunks.
2. **What is kept:** only findings that start on an added line of a file in the request
   (anything else is old code or another call's file), `ruleId` prefixed `logic/`, a CWE when
   the model names one (`CWE-476`, `CWE-193`, `CWE-754`, `CWE-755`, `CWE-480`, …), and an AI fix
   (`suggestion { kind: "ai_suggested" }`) only when every replaced line was added by this PR.
   Nothing is committed unless someone accepts it (FR-GH-04).
3. **Failure:** with no LLM answer there is no result, so the agent answers **503 `llm_failed`**
   (or `llm_unavailable` without a key) and the run shows as failed, never as a clean pass.

Python, JavaScript and TypeScript files are reviewed; others are `unsupported_language`.

## Configuration

See [`.env.example`](.env.example): `PORT` (default 8084), `SERVICE_TOKEN` (required), and the
`GROQ_*` / `GEMINI_*` / `LLM_*` variables from [`packages/llm`](../../packages/llm/README.md).
`LLM_MAX_BATCH_TOKENS` and `LLM_OTHER_CHANGES_TOKENS` must match the orchestrator's, or a full
batch is refused. Groq limits are per account: this agent can use its own account's
`GROQ_API_KEY`, named in the orchestrator's `GROQ_ACCOUNT_LOGIC`, so its calls do not eat the
other agents' quota.

## Develop

```bash
npm run build -w @code-sentinel/logic-agent
npm run start -w @code-sentinel/logic-agent   # reads services/logic-agent/.env
npm run test  -w @code-sentinel/logic-agent
```

**Manual check** (Git Bash, after `npm run build` at the root and with a Groq key in `.env`):

```bash
npm run start -w @code-sentinel/logic-agent
curl -s -X POST http://127.0.0.1:8084/v1/review -H "Authorization: Bearer <SERVICE_TOKEN>" \
  -H "Content-Type: application/json" --data-binary @review.json
```

with `review.json` holding a request whose `options.llmProvider` is `groq` and whose file has a
`content` where an added line uses a value that can be `None`. Expect a `logic/…` finding on that
line, with `llm.provider` set in the response.
