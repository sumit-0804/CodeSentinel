# Code-Sentinel

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
  orchestrator/  LangGraph orchestrator — fan-out, aggregation, severity ranking, context
packages/        Shared libraries (added as the build progresses)
docs/            Course deliverables and design artifacts
```

The gateway, agent services and clients land here as their work packages start (see
`docs/CodeSentinel_Project_Plan.pdf`).

## Getting started

Requires Node.js 20+.

```bash
npm install
npm run build
npm run test
npm run typecheck
```

The monorepo uses npm workspaces with [Turborepo](https://turbo.build/) for task running.

## Team

| Area | Members |
| --- | --- |
| Orchestration | Sumit Goyal, Durgesh |
| Agent Services | Tej Prakash Tak, Nevil Nandasana, Parin Makwana |
| Backend & Database | Ayush Soni |
| Integrations & DevOps | Vatsal Kamani |
| Frontend | Moksh Mehta |
