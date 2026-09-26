# @code-sentinel/security-agent

The Security Agent (FR-SEC-01..04). It scans the **added lines** of a pull request for common
vulnerabilities and hardcoded secrets, then, when the orchestrator reserved LLM quota for the
request, asks Groq (or Gemini) for what single-line rules cannot see. Built on
[`@code-sentinel/agent-kit`](../../packages/agent-kit/README.md), so it speaks
[`agent.yaml`](../../docs/design/openapi/agent.yaml) like every agent and can be called on its own
(FR-SEC-04).

## How a request is analyzed

1. **Rules** (`scan.ts`, always): every added line against the code rules for its language and
   every secret pattern. One finding per rule per line, with severity, confidence and CWE
   (FR-SEC-03). Comment lines skip code rules but not secret rules.
2. **LLM pass** (`llm-pass.ts`, only with `options.llmProvider`): one call for the whole request.
   The model sees each hunk with new-side line numbers, `+` for added lines, and **secrets already
   masked**. Its answer must match a strict JSON schema, is validated again with zod, and a
   finding is kept only if it starts on an added line of a file in the request. A finding with the
   same file and CWE as a rule finding within 3 lines of it is dropped as a duplicate: model line
   numbers can drift (Gemini put a rule's SQL injection 2 lines early in the 27-Sep live check).
   **AI fixes:** the model also returns `suggestedCode`, the replacement for `lineStart..lineEnd`.
   It becomes `suggestion { kind: "ai_suggested" }` (a one-click "suggested change" on the PR,
   FR-GH-03) only if every replaced line was added by this PR, the text actually changes them, and
   it contains no masked secret (`****`). When a duplicate carries a fix whose range covers the
   rule's line, the rule finding takes that fix and its range. Nothing is ever committed without
   the author accepting it (FR-GH-04).
3. If the LLM call fails or answers junk, the rule findings are still returned and the reason is
   logged; the review does not fail. Token usage is reported whenever a call was made.

`unknown`-language files (`.env`, YAML, JSON) are accepted so secrets in config are caught; code
rules apply only to Python, JavaScript and TypeScript.

## Rules

| `ruleId` | CWE | Severity | Languages | Matches |
| --- | --- | --- | --- | --- |
| `security/sql-injection` | CWE-89 | critical | py, js/ts | `.execute(f"…")`, `%` / `+` / `.format(` into `execute`; template literal or `+` into `.query(` / `.execute(` / `$queryRawUnsafe(` |
| `security/command-injection` | CWE-78 | critical / warning | py, js/ts | `subprocess.*(…, shell=True)`, `os.system` / `os.popen`, `exec(` with interpolation |
| `security/insecure-deserialization` | CWE-502 | critical | py, js/ts | `pickle` / `marshal` / `dill` `.load(s)`, `yaml.load` without a safe loader, `unserialize(` |
| `security/code-injection` | CWE-95 | warning | py, js/ts | `eval(` / `exec(`, `new Function(` |
| `security/xss` | CWE-79 | warning | js/ts, py | `innerHTML` / `outerHTML` assignment, `document.write`, `insertAdjacentHTML`, `dangerouslySetInnerHTML`, `mark_safe` / `Markup` on request data |
| `security/path-traversal` | CWE-22 | warning | py, js/ts | `open` / `send_file` / `os.path.join` / `Path` with request data; `readFile` / `sendFile` / `path.join` … with `req.params` / `query` / `body` |
| `security/secret-*` | CWE-798 | critical | all | AWS, GitHub, Google, Slack, Stripe live and Groq keys; private-key blocks; `password` / `secret` / `api_key` / `token` assignments with a high-entropy value (placeholders and env lookups ignored) |

The full list is served on `GET /v1/capabilities`.

**Secrets never leave the agent in clear.** Finding text shows only a masked prefix (`AKIA****`),
the LLM prompt is masked before it is built, and the model's descriptions are masked again.

## Configuration

See [`.env.example`](.env.example): `PORT` (default 8081), `SERVICE_TOKEN` (required), and the
`GROQ_*` / `GEMINI_*` / `LLM_*` variables from [`packages/llm`](../../packages/llm/README.md). With
no LLM key the agent logs a warning, reports `degraded` on `/healthz`, and runs its rules only; a
request that names a provider it has no key for gets 503 `llm_unavailable`.

## Develop

```bash
npm run build -w @code-sentinel/security-agent
npm run start -w @code-sentinel/security-agent   # reads services/security-agent/.env
npm run test  -w @code-sentinel/security-agent
```

**Manual check** (Git Bash, after `npm run build` at the root):

```bash
PORT=8081 SERVICE_TOKEN=local-service-token node services/security-agent/dist/server.js
curl -s -X POST http://127.0.0.1:8081/v1/review -H "Authorization: Bearer local-service-token" \
  -H "Content-Type: application/json" --data-binary @review.json
```

with `review.json` holding `exampleAgentReviewRequest` from `@code-sentinel/contracts/examples`.
Expect a `security/sql-injection` finding (CWE-89) on the `cur.execute(f"…")` line.
