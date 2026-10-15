# @code-sentinel/documentation-agent

The Documentation Agent (FR-DOC-01/02). For every **public** function, method and class whose
signature or body the pull request touches, it checks for a docstring or JSDoc that describes
the parameters and the return value. When one is missing or incomplete, it suggests one written
from what the code does. Public means exported in JavaScript / TypeScript, and a name without a
leading `_` in Python. Built on [`@code-sentinel/agent-kit`](../../packages/agent-kit/README.md).

## How a request is analyzed

1. **One LLM call** through agent-kit's `runLlmPass`, over each file whole with `+` on the added
   lines. The model sees whether a docstring already exists and what the function does.
2. **Findings** are `documentation/missing-docstring` or `documentation/incomplete-docstring`.
   Anything else the model returns is dropped (and counted in the log). Every finding is
   **`info`**, whatever the model says (FR-DOC-02), so it never blocks a merge on severity. The
   agent's default mode is Comment.
3. **The suggested docstring** replaces the signature line(s):
   - **JS/TS:** a JSDoc block, then the unchanged signature.
   - **Python:** the signature, then the docstring, in the file's own style.

   It becomes a one-click AI fix only when the signature lines were added by this PR; for an older
   function whose body changed, the text is in the description instead.
4. **Failure:** no LLM answer means **503 `llm_failed`** (or `llm_unavailable`), a failed run.

## Configuration

See [`.env.example`](.env.example): `PORT` (default 8085), `SERVICE_TOKEN`, and the `GROQ_*` /
`GEMINI_*` / `LLM_*` variables, with the batch sizes matching the orchestrator's. Its Groq account
is named in the orchestrator's `GROQ_ACCOUNT_DOCUMENTATION` (unset shares the orchestrator's own
account).

## Develop

```bash
npm run build -w @code-sentinel/documentation-agent
npm run start -w @code-sentinel/documentation-agent   # reads services/documentation-agent/.env
npm run test  -w @code-sentinel/documentation-agent
```

**Manual check:** start it, then `POST /v1/review` on port 8085 as in the
[Logic Agent README](../logic-agent/README.md#develop), with a new exported function without
JSDoc. Expect a `documentation/missing-docstring` finding (`info`) whose fix adds the JSDoc above
the signature.
