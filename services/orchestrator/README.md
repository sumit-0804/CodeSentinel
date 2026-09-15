# @code-sentinel/orchestrator

The LangGraph orchestrator. It fans a review request out to the enabled agent services in
parallel, applies the per-agent timeout, then **aggregates, de-duplicates and severity-ranks**
the findings and attaches similar past issues before returning one combined report
(FR-ORC-01…06).

Contract: [`docs/design/openapi/orchestrator.yaml`](../../docs/design/openapi/orchestrator.yaml).
Class design: [`docs/design/diagrams/mermaid/class_orchestrator.mmd`](../../docs/design/diagrams/mermaid/class_orchestrator.mmd).
Shared types and validators: [`@code-sentinel/contracts`](../../packages/contracts/README.md). The
orchestrator no longer defines `Finding`, `CombinedReport` and friends itself; import them from
there.

## What's scaffolded so far

| Area | Module | Status |
| --- | --- | --- |
| De-duplication (FR-ORC-03) | `aggregation/finding-aggregator.ts` | working |
| Severity ranking (FR-ORC-04) | `aggregation/severity-ranker.ts` | working |
| Summary counts | `aggregation/review-summary.ts` | working |
| Aggregate step | `aggregation/index.ts` → `aggregate()` | working |
| Context lookup (FR-ORC-05) | `context/similar-issue-lookup.ts` | interface + wiring, no vectors |
| Vector store (FR-VDB-01/02) | `context/vector-repository.ts` | interface + Chroma stub |

## Not started yet

- `ReviewJobController` + HTTP server (`/internal/v1/review-jobs`)
- `ReviewGraph` / `ReviewState` LangGraph wiring and `FanOutNode`
- `AgentClient` and the per-agent timeout
- `ThresholdNode` (confidence threshold pass, FR-ORC-06)
- `ReviewRepository` (PostgreSQL persistence)
- LLM abstraction layer

## Develop

```bash
npm install                                  # from the repo root
npm run test                                 # Turborepo builds contracts first, then runs every test
npm run test  -w @code-sentinel/orchestrator # needs a prior `npm run build -w @code-sentinel/contracts`
npm run build -w @code-sentinel/orchestrator
```
