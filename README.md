# Code-Sentinel

[![CI](https://github.com/sumit-0804/Code-Sentinel/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sumit-0804/Code-Sentinel/actions/workflows/ci.yml)

A multi-agent code review platform built on a service-oriented architecture.

Review work is split across five independent agent services — **Security, Style, Performance,
Logic, Documentation**. A LangGraph orchestrator fans a review request out to the agents in
parallel, then aggregates, de-duplicates and severity-ranks their findings into one combined
report. The platform is reachable from a GitHub App and a Next.js dashboard.

See [`docs/`](docs/) for the Proposal, Plan, Requirements Specification (BRD) and System Design
Document, and [`docs/design/`](docs/design/) for the architecture diagrams, OpenAPI contracts and
database schema.

## Repository layout

```
apps/            User-facing apps
  dashboard/     Next.js 16 dashboard — Supabase Auth (email, GitHub, Google), app shell, onboarding
services/        Deployable services (one per SOA component)
  gateway/       Express API gateway — webhook receipt, auth, routing to the orchestrator
  orchestrator/  LangGraph orchestrator — review-job API, fan-out, aggregation, severity ranking, context
  security-agent/ Security Agent — SAST and secret rules on added lines, plus an LLM pass over the whole files
  style-agent/   Style Agent — ESLint/Prettier and Ruff/Black in a per-request sandbox (Docker, or a child process on Render), no LLM
  performance-agent/ Performance Agent — N+1 queries, blocking calls and repeated work, by LLM over the whole files
  logic-agent/   Logic Agent — null handling, off-by-one and unhandled errors, by LLM over the whole files
  documentation-agent/ Documentation Agent — docstrings for public code the PR touches, by LLM (always info)
packages/        Shared libraries
  contracts/     zod schemas + types mirroring docs/design/openapi (every service imports these)
  llm/           Groq (primary) and Gemini (secondary) clients, quota budget, Gemini embeddings
  agent-kit/     Shared base of the agent services — agent.yaml routes, per-file skips, deadline, diff parsing, LLM pass
  service-kit/   Shared HTTP plumbing — JSON logger, request id, request log, ApiError handler, env file
  db/            Prisma 7 schema, migrations and client for the Supabase Postgres database
docs/            Course deliverables and design artifacts
render/          Render Blueprints (gateway, orchestrator, agents)
Dockerfile       One image per service (--build-arg SERVICE=<name>); the style-agent has its own
```

Every agent gets each changed file whole (up to the gateway's `FILE_CONTENT_MAX_BYTES`) with the
pull request's lines marked, and reports findings only on added lines. Files linked by imports are
reviewed in the same LLM call, and every call also sees the rest of the pull request's diffs.

## Getting started

Requires Node.js 20.19+ (Prisma 7). The database setup is in
[`packages/db/README.md`](packages/db/README.md).

```bash
npm install
npm run lint
npm run build
npm run test
npm run typecheck
```

The monorepo uses npm workspaces with [Turborepo](https://turbo.build/) for task running.

To run the pipeline locally:
- Copy each service's `.env.example` to `.env`, all seven with the same `SERVICE_TOKEN`.
- Point the gateway's `ORCHESTRATOR_URL` and the orchestrator's `AGENT_<KIND>_URL` at `http://127.0.0.1:<port>`: Security 8081, Style 8082, Performance 8083, Logic 8084, Documentation 8085. An agent without a URL is skipped ("Not deployed" on the PR page).
- Each LLM agent reads its own `GROQ_API_KEY`. Groq limits are per account, so an agent can use another account's key; name the account in the orchestrator's `GROQ_ACCOUNT_<KIND>` so it gets its own quota budget. All agents can share one `GEMINI_API_KEY` as the fallback.
- The gateway and the orchestrator use Supabase when `DATABASE_URL` is set (the same value in both), and memory otherwise. See the [gateway](services/gateway/README.md#persistence) and [orchestrator](services/orchestrator/README.md#persistence) Persistence sections.

Then, after `npm run build`, start each service in its own terminal:

```bash
npm run start -w @code-sentinel/orchestrator
```

```bash
npm run start -w @code-sentinel/security-agent
```

```bash
npm run start -w @code-sentinel/style-agent
```

```bash
npm run start -w @code-sentinel/performance-agent
```

```bash
npm run start -w @code-sentinel/logic-agent
```

```bash
npm run start -w @code-sentinel/documentation-agent
```

```bash
npm run start -w @code-sentinel/gateway
```

Each service README has a step-by-step manual check.

The dashboard runs on `http://localhost:3001` after copying `apps/dashboard/.env.example` to `.env.local`; see
[`apps/dashboard/README.md`](apps/dashboard/README.md). It calls the gateway from its server, so start the
gateway first with `DATABASE_URL` and `SUPABASE_URL` set (the gateway README's sign-in check):

```bash
npm run dev -w @code-sentinel/dashboard
```

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and on every push
to `main` and `dev`. The `checks` job runs on Node 20 and Node 22 (`fail-fast: false`, so one version
failing still reports the other) and executes, from a clean `npm ci`:

```bash
npm run lint       # ESLint flat config (eslint.config.mjs), every workspace
npm run build      # Turborepo builds contracts before its dependants
npm run typecheck
npx prisma migrate deploy   # in packages/db, against the job's Postgres service
npm run test
```

Each leg gets a throwaway `pgvector/pgvector:pg16` Postgres service. `DATABASE_URL` and
`TEST_DATABASE_URL` point at it, so the migrations are applied fresh and `packages/db`'s integration
tests run on every push.

A second job, `ci`, waits for both matrix legs and fails unless every leg succeeded. It runs even
when a leg fails or is skipped (`if: always()`), because GitHub counts a skipped required check as
passing. **`ci` is the only check branch protection needs to require.** Superseded runs on the
same ref are cancelled, and the workflow token is read-only.

### Branch protection

Branch protection is a repository setting, not a file. A repository admin enables it once:

1. Settings → Branches → Add branch ruleset (or classic branch protection rule) for `main`.
2. Turn on "Require status checks to pass before merging" and add `ci`.
3. Turn on "Require branches to be up to date before merging".

Or with the GitHub CLI:

```bash
gh api -X PUT repos/sumit-0804/Code-Sentinel/branches/main/protection --input - <<< '{"required_status_checks":{"strict":true,"contexts":["ci"]},"enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null}'
```

A pull request whose `ci` check fails then shows "Merging is blocked".

### Validating the workflow locally

[actionlint](https://github.com/rhysd/actionlint) checks the workflow syntax, expressions and
job references without pushing. From the repo root, with Docker running (macOS / Linux shell):

```bash
docker run --rm -v "$(pwd):/repo" -w /repo rhysd/actionlint:latest -color
```

On Windows, run the same command from PowerShell with `"${PWD}:/repo"` as the volume.

No output and exit code 0 means the workflow is valid.

## Deployment

| Part | Where | URL |
| --- | --- | --- |
| Dashboard | Vercel | `https://codesentinel.scribly.fun` |
| Gateway | Render, workspace A | `https://api.codesentinel.scribly.fun` (GitHub webhook: `/webhooks/github`) |
| Orchestrator | Render, workspace B | its `onrender.com` URL, called only by the gateway |
| Five agents | Render, workspace C | their `onrender.com` URLs, called only by the orchestrator |
| Database and sign-in | Supabase (dev project) | |

Everything runs on free plans:

- **Three Render workspaces.** Render gives each workspace 750 free hours a month, and a free
  service sleeps after 15 idle minutes. GitHub waits only about 10 s for a webhook answer, so the
  gateway and the orchestrator have a workspace each and stay awake (about 720 hours each).
- **Keep-warm job.** A [cron-job.org](https://cron-job.org) job requests both `/healthz` URLs every
  10 minutes.
- **Agents sleep.** The orchestrator wakes each one through `/healthz` before its review call
  (`AGENT_WAKE_TIMEOUT_MS=90000`).
- **Public calls between services.** Workspaces don't share a private network, so each hop is a
  public HTTPS call with `SERVICE_TOKEN`.

**Images.** The root [`Dockerfile`](Dockerfile) builds any service from its pruned workspace
(`turbo prune`). Render passes the `SERVICE` env var as the build arg:

```bash
docker build --build-arg SERVICE=gateway -t cs/gateway .
```

The style-agent has its own [`Dockerfile`](services/style-agent/Dockerfile), with the linters
installed and `SANDBOX_MODE=process`. Render can't run Docker inside a service; see the
[style-agent README](services/style-agent/README.md#process-mode-render).

**Blueprints.** One per workspace: [`render/gateway.yaml`](render/gateway.yaml),
[`render/orchestrator.yaml`](render/orchestrator.yaml) and [`render/agents.yaml`](render/agents.yaml).
In each workspace: **New → Blueprint**, pick this repo and the file, then type the values marked
`sync: false`:

- **Secrets:** `SERVICE_TOKEN` (the same everywhere), `DATABASE_URL`, the GitHub App and LLM keys,
  and `METRICS_TOKEN`.
- **Service URLs:** the other workspaces' `onrender.com` URLs.
- **The gateway also needs** the Secret File `github-app.pem`.

**Deploys.** Each service redeploys after CI passes on `main` (`autoDeployTrigger: checksPass`), and
only when its own paths change. The gateway runs `prisma migrate deploy` before it starts, because
free services have no pre-deploy step.

**The dashboard** is on Vercel; see the
[dashboard README](apps/dashboard/README.md#deploy-vercel). The DNS records are in Hostinger:

- `api.codesentinel`: CNAME to the gateway's `onrender.com` host
- `codesentinel`: CNAME to Vercel's target

## Team

| Area | Members |
| --- | --- |
| Orchestration | Sumit Goyal, Durgesh |
| Agent Services | Tej Prakash Tak, Nevil Nandasana, Parin Makwana |
| Backend & Database | Ayush Soni |
| Integrations & DevOps | Vatsal Kamani |
| Frontend | Moksh Mehta |
