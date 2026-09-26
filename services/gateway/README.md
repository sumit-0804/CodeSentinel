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
| Request id (NFR-12) + request log (morgan, redacted JSON lines, NFR-05) | [`@code-sentinel/service-kit`](../../packages/service-kit/README.md) | working |
| Security headers | `app.ts` (helmet) | working |
| Config from env, validated at startup | `config.ts`, `loadEnvFile` from `@code-sentinel/service-kit` | working |
| Error handling (`ApiError` bodies with `requestId`) | `HttpError`, `errorHandler` from `@code-sentinel/service-kit` | working |
| `GET /healthz` | `routes/healthz.ts` | working |
| Auth middleware + `GET /v1/me` (FR-GW-02) | `auth/authenticate.ts`, `routes/me.ts` | working |
| Session token (HS256 JWT) | `auth/session-token.ts` | working; nothing mints it outside tests until OAuth login lands |
| Stores | `persistence/stores.ts`, `persistence/in-memory.ts`, `persistence/dev-seed.ts` | interfaces + in-memory |
| GitHub client (FR-GH-01..03) | `github/octokit-github-client.ts` (GitHub App, installation tokens, paginated PR files, Check Runs, reviews), `github/stub-github-client.ts` | working; the stub records every call and is used when no App is configured |
| Publishing the review to the PR (FR-GH-02/03/04) | `github/review-publisher.ts`, `github/review-output.ts` | working |
| Orchestrator client (FR-GW-04) | `orchestrator/orchestrator-client.ts` (create job, poll job, health) | working, tested against a stubbed `fetch` |
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

## Publishing the review to the pull request

`seq_uc1_pr_review.mmd`, FR-GH-02..04. When the orchestrator answers 202 for a **new** job, the
webhook returns its 202 to GitHub first, then hands the job to `ReviewPublisher.follow()`, which
runs in the background and never throws. A redelivery (`duplicate_ignored`) publishes nothing, so
there is never a second Check Run or review.

1. **Check Run "Code-Sentinel", `in_progress`**, on the PR's head commit, right away (AC-01).
2. **Poll** `GET /internal/v1/review-jobs/{jobId}` every 2 s until the job is `completed`,
   `partial`, `failed` or `cancelled`, up to `REVIEW_POLL_TIMEOUT_MS` (5 min). Orchestrator errors
   are retried until then; a 404 (job gone) stops at once.
3. **One review, `event: COMMENT`** (never approves or blocks), when the repository has
   `postInlineComments` on. It has one inline comment per finding at or above the repository's
   confidence threshold (0.8 by default, FR-ORC-06) that either carries a fix or comes from the
   Security, Logic or Performance agent:
   - a fix is a ```` ```suggestion ```` block the author commits with one click; Style's
     Prettier/Black fixes are labelled deterministic, the Security Agent's LLM fixes AI-suggested
     (review before committing). Nothing is ever pushed to the branch (FR-GH-04);
   - Style lint findings without a fix are not posted inline; they are Check Run annotations;
   - at most 50 comments, highest ranked first; the rest are counted in the Check Run;
   - if GitHub refuses the review (422, a line it will not accept), each comment is posted on its
     own and the ones still refused are listed in the Check Run summary.
4. **Complete the Check Run** (FR-GH-02):

   | Conclusion | When |
   | --- | --- |
   | `failure` | a finding at or above the threshold is `critical` (even on a partial review) |
   | `neutral` | otherwise, the review is `partial`, `failed`, `cancelled`, or did not finish in time |
   | `success` | otherwise |

   The summary has the counts by severity, coverage (files and changed lines), one line per agent
   (✅ findings and provider, ⚠️ no result, ⏸️ LLM analysis deferred, ➖ not configured), skipped
   files with reasons, how many findings fell below the threshold, and any posting problems.
   Every finding at or above the threshold is an annotation on its lines (`failure` / `warning` /
   `notice`), sent 50 per request.

If the Check Run cannot be created (for example a missing permission), the review is still
posted and the failure is logged with the request id.

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

`server.ts` first loads an env file from `services/gateway/`, chosen by `NODE_ENV`:

| `NODE_ENV` | File |
| --- | --- |
| `production` | `.env.production` |
| anything else or unset | `.env` |

Both files are gitignored; copy `.env.example` to create them. Variables already set in the
process environment override the file, so a host's secret settings always win, and a missing file
is not an error. The `gateway listening` log line names the file it loaded.

| Variable | Default | Meaning | Validation |
| --- | --- | --- | --- |
| `PORT` | `3000` | Listen port | integer 1..65535 |
| `ORCHESTRATOR_URL` | required | Orchestrator base URL | http or https URL |
| `ORCHESTRATOR_TIMEOUT_MS` | `5000` | Timeout for each orchestrator call | integer 1000..30000 |
| `REVIEW_POLL_TIMEOUT_MS` | `300000` | How long to wait for a review job before completing its Check Run as timed out | integer 10000..1800000 |
| `SERVICE_TOKEN` | required | Sent to the orchestrator as a bearer token | non-empty |
| `JWT_SECRET` | required | HS256 key for the `cs_session` JWT | at least 32 characters |
| `GITHUB_WEBHOOK_SECRET` | required | GitHub App webhook secret | at least 16 characters |
| `GATEWAY_SEED` | `none` | `dev` loads in-memory demo data | `none` or `dev`; `dev` is refused when `NODE_ENV=production` |
| `GITHUB_APP_ID` | unset | The GitHub App's numeric id | positive integer; set together with `GITHUB_PRIVATE_KEY_PATH`; required when `NODE_ENV=production` |
| `GITHUB_PRIVATE_KEY_PATH` | unset | The App's private key (`.pem`), relative to `services/gateway/` | read at startup; an unreadable file stops the gateway. `*.pem` is gitignored |
| `GATEWAY_DEV_REPOSITORY` | unset | Points the dev seed's repository at a real repo, e.g. `sumit-0804/code-sentinel-playground:1390792507` | `owner/name:githubRepoId` |

An empty value (`PORT=`) means "use the default". With `GITHUB_APP_ID` and
`GITHUB_PRIVATE_KEY_PATH` set, PR files come from GitHub through the App; without them, from a stub
(dev seed files, or none). Until PostgreSQL lands, `GATEWAY_SEED=none` starts with empty stores.

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
- Storing Check Run and comment ids (`reviews.github_check_run_id`, `suggestions.github_comment_id`) once PostgreSQL lands
- Accept / reject tracking of posted suggestions (UC-3)
- Cancelling a superseded job when a new commit is pushed
- PostgreSQL stores and migrations from `schema.sql`
- Installation events (acknowledged and ignored today)
- An all-filtered pull request finishing the review with an empty report (today: 202
  `event_ignored`, no orchestrator call)

## Develop

```bash
npm install                             # from the repo root
npm run test                            # Turborepo builds contracts and service-kit first, then runs every test
npm run test  -w @code-sentinel/gateway # needs a prior build of contracts and service-kit
npm run build -w @code-sentinel/gateway
npm run lint  -w @code-sentinel/gateway
```

105 tests in 16 files. They run the real app on an ephemeral port (`withServer` from
`@code-sentinel/service-kit/testing`) with global `fetch`, stub the orchestrator and GitHub, and never need a real
secret, port 3000 or the network.

**Manual check** (Git Bash, from `services/gateway/` after `npm run build` at the root):

1. Start the real orchestrator on port 8080 with `SERVICE_TOKEN=local-service-token` (see the
   orchestrator README's manual check), or any fake that answers `202` with a `ReviewJob` and
   `200 {"status":"ok"}` on `/healthz`.
2. Start the gateway. These variables override `.env`, so the signing secret below is known:
   ```bash
   PORT=3000 ORCHESTRATOR_URL=http://127.0.0.1:8080 SERVICE_TOKEN=local-service-token \
   JWT_SECRET=0123456789abcdef0123456789abcdef GITHUB_WEBHOOK_SECRET=local-webhook-secret \
   GATEWAY_SEED=dev node dist/server.js
   ```
3. Write a `pull_request.opened` payload for repository id 123456789 to a file, sign it with
   `sha256=` + HMAC-SHA256(`local-webhook-secret`, file bytes), and `curl --data-binary @file`
   with `X-GitHub-Event: pull_request`, `X-GitHub-Delivery` and `X-Hub-Signature-256`. Expect 202
   `review_started`, and a job on the orchestrator with one file and two skipped files.
4. Send the same body signed with a wrong secret, with no signature, and `{not json` unsigned:
   each is 401 `invalid_signature` and the orchestrator receives nothing.
5. `curl /v1/me` is 401 `unauthenticated`; with `Authorization: Bearer cs_live_dev_00000000` it is
   200. `curl /healthz` is `ok`, and `degraded` / `unavailable` once the orchestrator stops.

## End to end with a real GitHub repository

A throwaway **private** repo, `sumit-0804/code-sentinel-playground` (id `1390792507`), holds a small
Python/JS app on `main` and a `demo/risky-change` branch that adds a SQL injection, a hardcoded AWS
example key (`AKIAIOSFODNN7EXAMPLE`, AWS's documented fake), `innerHTML` and badly formatted JS.

**One-time setup (GitHub web UI):**

1. Create a smee.io channel: open https://smee.io/new and copy its URL.
2. Settings → Developer settings → GitHub Apps → **New GitHub App**:
   - Homepage URL: the Code-Sentinel repo URL. Webhook URL: the smee channel URL. Webhook secret:
     the value of `GITHUB_WEBHOOK_SECRET` in `services/gateway/.env`.
   - Repository permissions: **Pull requests: Read and write** (inline review comments),
     **Checks: Read and write** (the Check Run), **Contents: Read** (Metadata: Read is automatic).
   - Subscribe to events: **Pull request**. Where can it be installed: **Only on this account**.
3. On the App page: note the **App ID**, then **Generate a private key** and save the `.pem` as
   `services/gateway/github-app.pem`.
4. **Install App** → only `code-sentinel-playground`.
5. In `services/gateway/.env`: `GITHUB_APP_ID=<id>`, `GITHUB_PRIVATE_KEY_PATH=github-app.pem`,
   `GATEWAY_SEED=dev`, `GATEWAY_DEV_REPOSITORY=sumit-0804/code-sentinel-playground:1390792507`.

**Each run:**

```bash
npx smee-client --url <smee channel URL> --target http://127.0.0.1:3000/webhooks/github
```

Start the orchestrator, the Security and Style agents, and the gateway (see the root README), then
open a pull request from `demo/risky-change` to `main` in the playground. The gateway log shows
`review_started` with the real files, and the orchestrator job ends with Security findings (SQL
injection, the AWS key, `innerHTML`) and Style findings with Prettier fixes. **Redeliver** from the
App's *Advanced → Recent Deliveries* page gives `duplicate_ignored`; a new push gives a new job.

