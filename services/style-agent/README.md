# @code-sentinel/style-agent

The Style Agent (FR-STY-01..04). It runs **ESLint + Prettier** on JavaScript/TypeScript and
**Ruff + Black** on Python, inside a **Docker sandbox started for each request**, and returns
lint findings plus **deterministic formatting fixes**. It makes no LLM call (NFR-07), so its fixes
are safe to apply without review. Built on
[`@code-sentinel/agent-kit`](../../packages/agent-kit/README.md), so it speaks
[`agent.yaml`](../../docs/design/openapi/agent.yaml) like every agent.

## How a request is analyzed

1. **Fragments** (`fragments.ts`): the extension picks the tools (FR-STY-01).
   - **Whole file** (the usual case): when the gateway sent the file (`ChangedFile.content`), it is
     one fragment, `f<file>.<ext>`, linted and formatted exactly as it is, with the lines this PR
     added marked. Nothing has to be wrapped or dedented, and the linters see the real imports and
     scopes. Files with no added lines are skipped.
   - **Hunks** (fallback, a file over the gateway's size cap): every hunk with added lines becomes
     its own small source file, named `f<file>_h<hunk>.<ext>`. The hunk's common indentation is removed first, so an indented method body
   parses as top-level code, and put back on the output. A real hunk usually starts or ends
   inside a block (GitHub's hunk for `cart.js` in the live check began inside `total()` and
   closed it), so for JS/TS the braces are counted — outside strings and comments — and the
   fragment gets one `function __cs_wrap__() {` line per unmatched `}` and one `}` per unclosed
   `{`. The code then parses at its real nesting; diagnostics are shifted past the wrapper and the
   wrapper lines are removed from the formatter output (no fix is offered if they do not survive
   formatting).
2. **Sandbox** (`sandbox.ts`, FR-STY-02): one `docker run` per request with every fragment
   mounted read-only. `sandbox/run.mjs` inside the image lints with ESLint / Ruff, formats with
   Prettier / Black, and prints one JSON result. The container has:

   | Flag | Why |
   | --- | --- |
   | `--network none` | Code under review can never reach the network |
   | `--read-only`, `--tmpfs /tmp` | Nothing is written outside a small scratch space |
   | `--memory 512m --cpus 1 --pids-limit 128` | A hostile file cannot starve the host |
   | `--cap-drop ALL --security-opt no-new-privileges`, user `node` | No privileges to escalate |
   | `--rm`, killed at the deadline | No container outlives its request |

   It is started with `execFile` (no shell), so no file name is ever interpreted.
3. **Findings** (`findings.ts`):
   - A diagnostic becomes a finding only if it lands on an **added** line, mapped back to the real
     line number (FR-STY-04). `ruleId` is `style/eslint/<rule>` or `style/ruff/<code>`; likely-bug
     rules (Ruff `F` / `B`, a few ESLint ones) are `warning`, the rest `info`.
   - Formatter output is aligned with the hunk line by line (a longest common subsequence on
     lines compared without whitespace or a trailing `;` / `,`), so a reformatted line pairs with
     its original even when the formatter also split or joined its neighbours. Each changed block
     made only of **added** lines becomes a `style/prettier` or `style/black` finding with a
     `suggestion { kind: "deterministic" }` (FR-STY-03). Blocks at most 3 unchanged lines apart are
     merged into one fix ("N formatting changes from prettier"), with the lines between copied as they
     are, so one click applies them all. Unchanged lines are never modified, even when the formatter
     would change them too.
   - New code that the formatter joins with unchanged code is flagged without a fix ("run the
     formatter on the file").
   - A fragment that does not parse on its own (for example a hunk that closes a brace it did not
     open) produces nothing; how many were left out is logged. A hunk from inside a function
     keeps its bare `return` parseable: ESLint retries it in CommonJS mode.

Rules that need the whole file are still off, because the hunk fallback cannot show them and one
sandbox config serves both paths: ESLint `no-undef`,
`no-unused-vars`, `no-unreachable`; Ruff `F821`, `F401`, `F841`, `F811`, `E402`. See
[`sandbox/eslint.config.mjs`](sandbox/eslint.config.mjs) and [`sandbox/ruff.toml`](sandbox/ruff.toml).

If the sandbox is stopped at the deadline, every file is `over_budget`. If Docker is down or the
image is missing, `POST /v1/review` answers 503 `sandbox_unavailable` and `/healthz` reports
`checks.sandbox: unavailable` (503).

## The sandbox image

`sandbox/Dockerfile`: `node:22-slim` with pinned **ESLint 9.39.5**, **Prettier 3.9.9**,
**typescript-eslint 8.70.1**, **Ruff 0.16.9** and **Black 26.5.1** (about 480 MB).

```bash
npm run sandbox:build -w @code-sentinel/style-agent   # tags code-sentinel/style-sandbox:2
```

Change a version in `sandbox/package.json` or the `Dockerfile`, then rebuild and bump the tag. Keep
the versions in the service's own [`Dockerfile`](Dockerfile) the same.

## Process mode (Render)

Render can't run Docker inside a service, so the deployed agent uses `SANDBOX_MODE=process`
(`ProcessSandbox`). Its image ([`Dockerfile`](Dockerfile), built from the repo root) holds the
same pinned linters in `/opt/lint`; each request's files go in `/opt/lint/work/<uuid>` and
`run.mjs` runs as a child process:

- `execFile`, never a shell, with only `PATH`, `HOME` and the lint paths in its env, so no
  `SERVICE_TOKEN` or other secret reaches it
- a 384 MB Node heap cap and the 60 s timeout; one request at a time
- the folder is deleted afterwards

It gives up the container's `--network none`, read-only root and hard memory cap. That's acceptable:
the agent holds no LLM key, and the linters parse the code without running it. `/healthz` checks
that `run.mjs`, ESLint, `ruff` and `black` are there.

## Configuration

See [`.env.example`](.env.example): `PORT` (default 8082), `SERVICE_TOKEN` (required),
`SANDBOX_MODE` (`docker`, the default, or `process`), `STYLE_SANDBOX_IMAGE` (Docker mode, default
`code-sentinel/style-sandbox:2`) and `LINT_ROOT` (process mode, default `/opt/lint`). Docker mode
needs a Docker engine on the host.

## Develop

```bash
npm run build -w @code-sentinel/style-agent
npm run test  -w @code-sentinel/style-agent                         # unit tests, fake sandbox
STYLE_SANDBOX_IT=1 npm run test -w @code-sentinel/style-agent       # also runs the real image
npm run start -w @code-sentinel/style-agent                         # reads services/style-agent/.env
```

CI runs the unit tests only; the real-image test needs Docker and the built image. The process-mode
test runs inside the service image:

```bash
docker build -f services/style-agent/Dockerfile -t cs/style-agent .   # from the repo root
```
