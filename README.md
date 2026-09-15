# Code-Sentinel

[![CI](https://github.com/sumit-0804/Code-Sentinel/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sumit-0804/Code-Sentinel/actions/workflows/ci.yml)

A multi-agent code review platform built on a service-oriented architecture.

Review work is split across five independent agent services — **Security, Style, Performance,
Logic, Documentation**. A LangGraph orchestrator fans a review request out to the agents in
parallel, then aggregates, de-duplicates and severity-ranks their findings into one combined
report. The platform is reachable from a GitHub App, a VS Code extension and a Next.js dashboard.

See [`docs/`](docs/) for the Proposal, Plan, Requirements Specification (BRD) and System Design
Document, and [`docs/design/`](docs/design/) for the architecture diagrams, OpenAPI contracts and
database schema.

## Repository layout

```
services/        Deployable services (one per SOA component)
  gateway/       Express API gateway — webhook receipt, auth, routing to the orchestrator
  orchestrator/  LangGraph orchestrator — fan-out, aggregation, severity ranking, context
packages/        Shared libraries
  contracts/     zod schemas + types mirroring docs/design/openapi (every service imports these)
docs/            Course deliverables and design artifacts
```

The agent services and clients land here as their work packages start (see
`docs/CodeSentinel_Project_Plan.pdf`).

## Getting started

Requires Node.js 20+.

```bash
npm install
npm run lint
npm run build
npm run test
npm run typecheck
```

The monorepo uses npm workspaces with [Turborepo](https://turbo.build/) for task running.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and on every push
to `main`. The `checks` job runs on Node 20 and Node 22 (`fail-fast: false`, so one version
failing still reports the other) and executes, from a clean `npm ci`:

```bash
npm run lint       # ESLint flat config (eslint.config.mjs), every workspace
npm run build      # Turborepo builds contracts before its dependants
npm run typecheck
npm run test
```

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

## Team

| Area | Members |
| --- | --- |
| Orchestration | Sumit Goyal, Durgesh |
| Agent Services | Tej Prakash Tak, Nevil Nandasana, Parin Makwana |
| Backend & Database | Ayush Soni |
| Integrations & DevOps | Vatsal Kamani |
| Frontend | Moksh Mehta |
