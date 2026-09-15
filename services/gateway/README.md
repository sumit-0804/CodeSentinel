# @code-sentinel/gateway

The API gateway: the single Express entry point for the GitHub App, the VS Code extension and the
dashboard (FR-GW-01). It verifies GitHub webhooks (FR-GW-03), authenticates session and API-key
traffic (FR-GW-02), and forwards review jobs to the orchestrator, relaying its answer (FR-GW-04).

Public contract: [`docs/design/openapi/gateway.yaml`](../../docs/design/openapi/gateway.yaml).
Orchestrator contract it calls: [`docs/design/openapi/orchestrator.yaml`](../../docs/design/openapi/orchestrator.yaml).
Components: [`component.mmd`](../../docs/design/diagrams/mermaid/component.mmd). Webhook sequence:
[`seq_uc1_pr_review.mmd`](../../docs/design/diagrams/mermaid/seq_uc1_pr_review.mmd). Every request and
response shape comes from [`@code-sentinel/contracts`](../../packages/contracts/README.md).

## What's scaffolded so far

| Area | Module | Status |
| --- | --- | --- |
| Request id (NFR-12) + request log (morgan, redacted JSON lines, NFR-05) | `http/request-id.ts`, `http/request-logger.ts`, `logging/logger.ts` | working |
| Security headers | `app.ts` (helmet) | working |
| Config from env, validated at startup | `config.ts` | working |
| Error handling (`ApiError` bodies with `requestId`) | `http/errors.ts`, `http/error-handler.ts` | working |
| `GET /healthz` | `routes/healthz.ts` | working |
| Auth middleware + `GET /v1/me` (FR-GW-02) | `auth/authenticate.ts`, `routes/me.ts` | working |
| Session token (HS256 JWT) | `auth/session-token.ts` | working; nothing mints it outside tests until OAuth login lands |
| Stores | `persistence/stores.ts`, `persistence/in-memory.ts`, `persistence/dev-seed.ts` | interfaces + in-memory |
| GitHub client | `github/github-client.ts`, `github/stub-github-client.ts` | interface + stub |
| Orchestrator client (FR-GW-04) | `orchestrator/orchestrator-client.ts` | working, tested against a stubbed `fetch` |
| Webhook signature (FR-GW-03) | `webhooks/signature.ts` | working |
| Webhook handler (FR-GH-01) | `webhooks/github-webhook.ts`, `webhooks/github-payload.ts` | working |
| File filter | `webhooks/file-filter.ts` | working |
| Review job builder (NFR-13) | `webhooks/review-job-request.ts` | working |

## Webhook flow

`POST /webhooks/github` reads the body with `express.raw`, so the signature is computed over the
exact bytes GitHub signed. Checks run in this order and stop at the first that applies:

| # | Condition | HTTP | `code` / `action` | Log `outcome` |
| --- | --- | --- | --- | --- |
| 1 | `X-Hub-Signature-256` missing or wrong (the body is never parsed, logged or forwarded) | 401 | `invalid_signature` | `invalid_signature` |
| 2 | `X-GitHub-Event` or `X-GitHub-Delivery` missing | 400 | `missing_header` | `missing_header` |
| 3 | Body is not JSON | 400 | `invalid_payload` | `invalid_payload` |
| 4 | Not `pull_request` `opened` / `synchronize` / `reopened` (`ping`, `installation*`, other actions) | 202 | `event_ignored` | `event_ignored` |
| 5 | Payload fails the minimal `pull_request` schema | 400 | `invalid_payload` | `invalid_payload` |
| 6 | `repository.id` not known | 202 | `event_ignored` | `repository_unknown` |
| 6 | Repository has `reviewEnabled: false` | 202 | `repository_disabled` | `repository_disabled` |
| 7 | Every agent disabled (the orchestrator would answer 422) | 202 | `repository_disabled` | `repository_disabled` |
| 8 | Every PR file filtered out; no orchestrator call | 202 | `event_ignored` | `no_reviewable_files` |
| 9 | Orchestrator answers 202 | 202 | `review_started` + `reviewId` | `review_started` |
| 9 | Orchestrator answers 200 (job exists for this delivery) | 202 | `duplicate_ignored` + `reviewId` | `duplicate_ignored` |
| 9 | Orchestrator timed out, unreachable, non-2xx or invalid body | 502 | `orchestrator_unavailable` (`details.kind`, `details.status`) | `orchestrator_unavailable` |

The job is sent with `Idempotency-Key` = the delivery id and `X-Request-Id` = the request id, so a
GitHub redelivery after a 502 cannot start a second review. The gateway never looks at the PR
author, so external contributors take the same path (AC-10). The request log line carries
`deliveryId`, `event`, `action`, `repository`, `files`, `skippedFiles` counts and `outcome`.

**File filter** (`filterPullRequestFiles`), applied to GitHub's PR file list in GitHub's order:

| GitHub file | Result |
| --- | --- |
| `status: removed` or `unchanged` | dropped, not reported |
| `renamed` without a `patch` (pure rename) | dropped, not reported |
| lockfile (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `npm-shrinkwrap.json`, `poetry.lock`, `Pipfile.lock`, `Cargo.lock`, `go.sum`, `composer.lock`, `Gemfile.lock`), `*.min.js`, `*.min.css`, `*.map`, `*.snap`, or a directory named `node_modules`, `vendor`, `dist`, `build`, `__generated__`, `generated` | skipped `generated_file` |
| no `patch`, binary extension (png, jpg, jpeg, gif, ico, pdf, zip, gz, woff, woff2, ttf, eot, mp4, webp, svgz, jar, class, exe, dll, so, wasm) | skipped `binary` |
| no `patch`, any other file (GitHub omits oversized diffs) | skipped `too_large` |
| `added`, `modified`, `changed` | kept, `changeType` `added` / `modified` |
| `renamed` with a `patch` | kept, `changeType: renamed`, `previousPath` |
| `copied` | kept, `changeType: added` |

Language comes from the extension: `js/mjs/cjs/jsx` → `javascript`, `ts/mts/cts/tsx` → `typescript`,
`py` → `python`, anything else → `unknown`, which is still sent (agents skip it as
`unsupported_language`, and the Documentation agent may still use it).

## Authentication

`/v1` routes pass through `createAuthMiddleware`, which sets `res.locals.principal`
(`userId`, `organizationId`, `method`). Two schemes, as in `gateway.yaml`:

| Scheme | Client | Check |
| --- | --- | --- |
| `Authorization: Bearer cs_live_…` | VS Code | SHA-256 of the key matches an active (not revoked) row in `api_keys`; `lastUsedAt` is updated |
| `cs_session` cookie | Dashboard | HS256 JWT (`sub` = user, `org` = organization, `jti` = session, `iss` = `code-sentinel`, `exp`) signed with `JWT_SECRET`, then its SHA-256 matches an active, unexpired row in `sessions` with the same ids |

The session store is consulted even after the JWT verifies, so logging out or revoking a session
takes effect immediately instead of at `exp`. API keys are opaque and never parsed as JWTs: a
bearer token without the `cs_live_` prefix is rejected outright. Credentials are stored only as
SHA-256 hashes; a salted hash such as bcrypt would prevent the unique-hash lookup `schema.sql` uses,
and the keys are high-entropy random strings, not passwords.

| `code` | HTTP | When |
| --- | --- | --- |
| `unauthenticated` | 401 | No `Authorization` header and no `cs_session` cookie |
| `invalid_credentials` | 401 | A credential is present but unknown, revoked, expired, badly signed, or its user no longer exists |
| `invalid_signature` | 401 | Webhook signature check failed (webhooks only) |

`signSessionToken()` is exported for the GitHub OAuth login step; until then only tests call it.

## Configuration

Read by `loadGatewayConfig()` at startup; every invalid variable is reported in one error, then the
process exits with code 1. See [`.env.example`](.env.example).

| Variable | Default | Meaning | Validation |
| --- | --- | --- | --- |
| `PORT` | `3000` | Listen port | integer 1..65535 |
| `ORCHESTRATOR_URL` | required | Orchestrator base URL | http or https URL |
| `ORCHESTRATOR_TIMEOUT_MS` | `5000` | Timeout for each orchestrator call | integer 1000..30000 |
| `SERVICE_TOKEN` | required | Sent to the orchestrator as a bearer token | non-empty |
| `JWT_SECRET` | required | HS256 key for the `cs_session` JWT | at least 32 characters |
| `GITHUB_WEBHOOK_SECRET` | required | GitHub App webhook secret | at least 16 characters |
| `GATEWAY_SEED` | `none` | `dev` loads in-memory demo data | `none` or `dev` |

An empty value (`PORT=`) means "use the default". Until PostgreSQL and the Octokit client land,
`GATEWAY_SEED=none` starts with empty stores and a GitHub stub that returns no files.

`GATEWAY_SEED=dev` is for the local manual check only. It seeds one organization, the repository
`code-sentinel/consumer-api` (`githubRepoId` 123456789, all five agents enabled, platform threshold
0.8), the user `octo-dev` with the API key **`cs_live_dev_00000000`** (`DEV_API_KEY`), and a GitHub
stub whose pull requests contain `payments/retry_queue.py` (reviewed), `package-lock.json`
(`generated_file`) and `logo.png` (`binary`).

## Not started yet

- `/v1/reviews`: create (on-demand), list, get, SSE events, style fixes
- Findings accept / reject (`/v1/findings/{findingId}/suggestion/...`)
- Repositories and config routes (`/v1/repositories`, admin-role check)
- API-key management (`/v1/me/api-keys`)
- Rate limiting (FR-GW-05)
- GitHub OAuth login that mints the session cookie
- Octokit `GitHubClient` (installation tokens, paginated PR files), Check Runs and inline
  suggestions (FR-GH-02/03)
- PostgreSQL stores and migrations from `schema.sql`
- Installation events (acknowledged and ignored today)
- An all-filtered pull request finishing the review with an empty report (today: 202
  `event_ignored`, no orchestrator call)

## Develop

```bash
npm install                             # from the repo root
npm run test                            # Turborepo builds contracts first, then runs every test
npm run test  -w @code-sentinel/gateway # needs a prior `npm run build -w @code-sentinel/contracts`
npm run build -w @code-sentinel/gateway
npm run lint  -w @code-sentinel/gateway
```

93 tests in 16 files. They run the real app on an ephemeral port (`withServer` in
`src/test-support/`) with global `fetch`, stub the orchestrator and GitHub, and never need a real
secret, port 3000 or the network.

**Manual check** (Git Bash, from `services/gateway/` after `npm run build` at the root):

1. Start a fake orchestrator on port 8080 that prints each request and answers `202` with a
   `ReviewJob` (and `200 {"status":"ok"}` on `/healthz`).
2. Start the gateway:
   ```bash
   PORT=3000 ORCHESTRATOR_URL=http://127.0.0.1:8080 SERVICE_TOKEN=local-service-token \
   JWT_SECRET=0123456789abcdef0123456789abcdef GITHUB_WEBHOOK_SECRET=local-webhook-secret \
   GATEWAY_SEED=dev node dist/server.js
   ```
3. Write a `pull_request.opened` payload for repository id 123456789 to a file, sign it with
   `sha256=` + HMAC-SHA256(`local-webhook-secret`, file bytes), and `curl --data-binary @file`
   with `X-GitHub-Event: pull_request`, `X-GitHub-Delivery` and `X-Hub-Signature-256`. Expect 202
   `review_started`, and a job on the fake orchestrator with one file and two skipped files.
4. Send the same body signed with a wrong secret, with no signature, and `{not json` unsigned:
   each is 401 `invalid_signature` and the fake orchestrator receives nothing.
5. `curl /v1/me` is 401 `unauthenticated`; with `Authorization: Bearer cs_live_dev_00000000` it is
   200. `curl /healthz` is `ok`, and `degraded` / `unavailable` once the fake orchestrator stops.
