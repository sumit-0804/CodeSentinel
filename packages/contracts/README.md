# @code-sentinel/contracts

Shared request/response shapes for every Code-Sentinel service, as [zod](https://zod.dev) schemas
with their TypeScript types inferred from them. One schema per OpenAPI schema in
[`docs/design/openapi/`](../../docs/design/openapi/), so a `Finding` produced by an agent, carried
by the orchestrator and rendered by a client is described exactly once and validated at runtime
with the same definition that types the code.

| Module | Mirrors | Holds |
| --- | --- | --- |
| `common.ts` | `common.yaml` | `Finding`, `ChangedFile`, `SkippedFile`, `CombinedReport`, `AgentRunSummary`, `ReviewCoverage`, `ApiError`, … |
| `agent.ts` | `agent.yaml` | `AgentReviewRequest`, `AgentReviewResponse`, `Capabilities`, `Health` |
| `orchestrator.ts` | `orchestrator.yaml` | `ReviewJobRequest`, `ReviewJob`, `AgentHealthSnapshot` |
| `gateway.ts` | `gateway.yaml` | `CreateReviewRequest`, `ReviewListItem`, `RepositoryConfig`, `CurrentUser`, `ApiKey`, … |
| `examples.ts` | the YAML `example` blocks | Valid payloads for tests, exported as `@code-sentinel/contracts/examples` |

## Conventions

- `FooSchema` is the zod schema; `Foo` is `z.infer<typeof FooSchema>`. Both are exported.
- Types are zod **output** types: a field with an OpenAPI `default` is optional on the wire but
  present after `parse()`. `ReviewJobRequestInput` is the one pre-default (input) type exported,
  for callers building a request.
- OpenAPI `Error` is exported as `ApiError` so it does not shadow the global `Error`.
- `ReviewJob.status` includes `cancelled`, which a `CombinedReport.status` never does, so the two
  enums are separate (`ReviewJobStatus` vs `ReviewStatus`).
- Unknown keys are stripped, except `AgentReviewRequest.options`, which passes agent-specific
  switches through untouched (`additionalProperties: true` in the spec).

## Usage

```ts
import { AgentReviewRequestSchema, type Finding } from "@code-sentinel/contracts";

// Validate an HTTP body. safeParse never throws; return 400 with the issues on failure.
const result = AgentReviewRequestSchema.safeParse(req.body);
if (!result.success) {
  return res.status(400).json({ code: "invalid_body", message: result.error.message });
}
const request = result.data; // typed AgentReviewRequest, defaults applied

// Use the types on their own where no validation is needed.
const findings: Finding[] = [];
```

In tests, build valid payloads from the examples instead of copying literals:

```ts
import { exampleAgentReviewRequest, exampleFinding } from "@code-sentinel/contracts/examples";
```

## Changing a contract

1. Change the OpenAPI file under `docs/design/openapi/` first. It is the source of truth.
2. Mirror the change here in the matching module and add a valid and an invalid test case.
3. Run `npm run build -w @code-sentinel/contracts` so dependants pick up the new `dist/`.

Nothing generates this package from the YAML; the tests are what keep the two aligned.

## Develop

```bash
npm install                                  # from the repo root
npm run test  -w @code-sentinel/contracts
npm run build -w @code-sentinel/contracts    # emits dist/, which consumers resolve
```

Consumers add `"@code-sentinel/contracts": "*"` to their `dependencies`; npm workspaces link it,
and Turborepo builds it before any dependant's `build`, `typecheck` or `test` task.
