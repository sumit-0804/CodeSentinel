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
| `GET /healthz` | `routes/healthz.ts` | working; reports the orchestrator and, with `DATABASE_URL`, the database |
| Auth middleware + `GET /v1/me` (FR-GW-02) | `auth/authenticate.ts`, `auth/supabase-token.ts`, `routes/me.ts` | working: `cs_live_` API keys and Supabase access tokens; see [Authentication](#authentication) |
| Route guards | `auth/guards.ts` (`requireUserSession`, `requireOrganization`, `assertOrgAdmin`) | used by the GitHub, repository and organization routes |
| Connecting GitHub (A6) | `routes/github.ts`, `github/github-user-client.ts`, `github/installation-sync.ts` | working; see [Connecting GitHub](#connecting-github) |
| `GET /v1/repositories` | `routes/repositories.ts` | working: the organization's active repositories |
| Repository configuration (A9) | `routes/repositories.ts`, `routes/organizations.ts`, `persistence/effective-config.ts`, `webhooks/branch-match.ts` | working: agent modes, organization defaults, branches to review; see [Repository configuration](#repository-configuration) |
| Installation webhooks | `webhooks/installation-events.ts` | working: install, uninstall, suspend, repositories added or removed |
| Stores | `persistence/stores.ts`, `persistence/prisma-stores.ts` (Supabase Postgres), `persistence/in-memory.ts` + `persistence/dev-seed.ts` | working; see [Persistence](#persistence) |
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
| 4 | `installation` or `installation_repositories`: see [the table below](#installation-events) | 202 | `installation_synced` / `event_ignored` | as below |
| 4 | Not `pull_request` `opened` / `synchronize` / `reopened` (`ping`, other actions) | 202 | `event_ignored` | `event_ignored` |
| 5 | Payload fails the minimal `pull_request` schema | 400 | `invalid_payload` | `invalid_payload` |
| 6 | `repository.id` not known, removed from its installation, or its installation uninstalled or suspended | 202 | `event_ignored` | `repository_unknown` |
| 6 | Repository has `reviewEnabled: false` | 202 | `repository_disabled` | `repository_disabled` |
| 7 | Every agent `off` (the orchestrator would answer 422) | 202 | `repository_disabled` | `repository_disabled` |
| 8 | `pull_request.base.ref` matches none of the [branches to review](#repository-configuration) | 202 | `branch_ignored` | `branch_ignored` (+ `baseRef`) |
| 9 | Every PR file filtered out; no orchestrator call | 202 | `event_ignored` | `no_reviewable_files` |
| 10 | Orchestrator answers 202 | 202 | `review_started` + `reviewId` | `review_started` |
| 10 | Orchestrator answers 200 (job exists for this delivery) | 202 | `duplicate_ignored` + `reviewId` | `duplicate_ignored` |
| 10 | Orchestrator timed out, unreachable, non-2xx or invalid body | 502 | `orchestrator_unavailable` (`details.kind`, `details.status`) | `orchestrator_unavailable` |

The job is sent with `Idempotency-Key` = the delivery id and `X-Request-Id` = the request id, so a
GitHub redelivery after a 502 cannot start a second review. The gateway never looks at the PR
author, so external contributors take the same path (AC-10). The request log line carries
`deliveryId`, `event`, `action`, `repository`, `files`, `skippedFiles` counts and `outcome`.

### Installation events

GitHub sends these to every App; the gateway keeps Supabase in step as the App (no user involved, so
memberships are untouched; people join an organization through their own sync).

| Event / action | What changes | Log `outcome` |
| --- | --- | --- |
| `installation` `created`, `new_permissions_accepted`, `unsuspend` | The account's organization and the installation are upserted, and its repositories made to match the App's list (`GET /installation/repositories`) | `installation_synced` |
| `installation` `deleted` | Installation marked uninstalled, its repositories marked removed (rows and review history stay) | `installation_removed` |
| `installation` `suspend` | Installation marked suspended: its PRs are ignored until `unsuspend` | `installation_suspended` |
| `installation_repositories` `added` | Same as `created` (the payload lacks branches and languages, so the App's list is the source) | `installation_synced` |
| `installation_repositories` `removed` | Those repositories marked removed | `repositories_removed` |
| any other `installation` action | nothing | `event_ignored` |

A malformed payload is 400 `invalid_payload`. If GitHub fails during the sync the answer is 502
`github_unavailable`, which marks the delivery failed on GitHub so it can be redelivered.

## Connecting GitHub

How a signed-in user gets organizations and repositories (A6, `seq_onboarding.mmd`):

1. The dashboard sends them to `github.com/apps/<slug>/installations/new` (or, to join organizations the
   App is already on, to GitHub's authorize page) with a random `state` it keeps in a cookie.
2. GitHub redirects to the dashboard's callback with a `code`. With **Request user authorization
   (OAuth) during installation** on, installing also authorizes. The dashboard checks the `state`, then
   calls **`POST /v1/github/link { code }`**:
   - exchanges the code for a GitHub App **user token** (8 h, plus a 6-month refresh token) using the
     App's client ID and secret
   - `GET /user`, and records `users.github_user_id` / `github_login`. One GitHub account belongs to one
     Code Sentinel user: another user's account is 409 `github_account_taken`
   - stores both tokens **sealed** with `SecretBox` (AES-256-GCM, `FIELD_ENCRYPTION_KEY`); plaintext is
     never stored or logged
   - runs the sync and answers with each installation's account and repository count
3. **Sync** (`InstallationSync`, also `POST /v1/installations/sync`): the user's token, refreshed first
   if it expires within a minute, lists their installations (`GET /user/installations`). Each one is
   upserted with its repositories (as the App), and the user's membership is recorded: **admin** of
   their own account, and for an organization the role GitHub reports (`GET /user/memberships/orgs/{org}`,
   which needs the App's **Members: read** permission). If GitHub won't say, `member` is added but an
   existing role is never lowered.
4. `GET /v1/installations` lists the user's installations, and `GET /v1/repositories` an organization's
   active repositories (`X-Organization-Id`, or the only membership; API keys use their own).

Repositories are matched by GitHub id, so a rename updates the name in place. A repository that leaves
its installation is **marked removed, never deleted**, and comes back with its history if added again.

| `code` | HTTP | When |
| --- | --- | --- |
| `github_code_invalid` | 400 | GitHub refused the code (used, expired, or for another App) |
| `github_account_taken` | 409 | The GitHub account is linked to another user |
| `github_not_linked` | 409 | Sync without a stored token, or the refresh token has run out |
| `github_unavailable` | 502 | GitHub did not answer during the exchange or the sync |
| `github_link_unconfigured` | 503 | `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` or `FIELD_ENCRYPTION_KEY` not set |

These are account routes: API keys get 403 `session_required`. A7 adds a TOTP step-up to `link` and `sync`.

## Repository configuration

How each repository is reviewed (A9, UC-4). Every agent has a **mode**:

| Mode | Runs | Posts findings | Fails the Check Run on a critical finding |
| --- | --- | --- | --- |
| `off` | no | no | no |
| `comment` | yes | yes | no (the Check Run is `neutral`) |
| `block` | yes | yes | yes |

**Where values come from** (`resolveEffectiveConfig()`, `persistence/effective-config.ts`):
- **Agent modes and branches:** while `repositories.use_org_defaults` is true (the default), from the
  organization's review defaults (`organization_agent_defaults`, `organizations.default_review_branches`);
  otherwise from the repository's own rows (`repository_agent_config`, `repository_settings.review_branches`).
  An agent with nothing set uses the **platform default: `block` for Security, `comment` for the rest**.
- **Confidence threshold:** the repository override, then the organization default, then 0.8 (unchanged).
- **Branches to review:** names or globs a pull request must merge **into** (`main`, `release/*`,
  `hotfix/**`), matched with `picomatch`: case-sensitive, `*` is one path segment and `**` any number
  (so `**` means every branch). Nothing set means the repository's default branch only. Up to 20
  patterns of 1–100 characters, no spaces or `..`.

**API** (`gateway.yaml`):

| Route | Who |
| --- | --- |
| `GET /v1/repositories/{id}/config` | any member (or the organization's API key); another organization's repository is 404 |
| `PUT /v1/repositories/{id}/config` | a signed-in **admin** of the repository's organization |
| `GET /v1/organizations/{id}/review-defaults` | any member (or the organization's API key) |
| `PUT /v1/organizations/{id}/review-defaults` | a signed-in **admin** of that organization |

Both `PUT`s are partial updates (omitted fields keep their value) and answer with the new
configuration. The repository `PUT` also takes `reviewEnabled` and `useOrgDefaults`, and
`confidenceThresholdOverride: null` restores inheritance. Errors: 400 `invalid_body` (with zod's
`issues`), 400 `no_agents_enabled` when every agent would end up `off` (switch reviews off instead),
403 `session_required` for an API key, 403 `admin_required` for a member. A7 adds a TOTP step-up to
both `PUT`s. Each row written records `updated_by`.

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
   | `failure` | a finding at or above the threshold is `critical` and its agent is in `block` mode (even on a partial review) |
   | `neutral` | otherwise, a `critical` finding from a `comment` agent, or the review is `partial`, `failed`, `cancelled`, or did not finish in time |
   | `success` | otherwise |

   The summary says which agents blocked the merge (or which comment-only agents found critical
   issues), then the counts by severity, coverage (files and changed lines), one line per agent
   (✅ findings and provider, ⚠️ no result, ⏸️ LLM analysis deferred, ➖ not configured), skipped
   files with reasons, how many findings fell below the threshold, and any posting problems.
   Every finding at or above the threshold is an annotation on its lines (`failure` / `warning` /
   `notice`), sent 50 per request.

If the Check Run cannot be created (for example a missing permission), the review is still
posted and the failure is logged with the request id.

## Authentication

`/v1` routes pass through `createAuthMiddleware`, which reads `Authorization: Bearer <token>` and
sets `res.locals.principal`: `userId`, `method`, `organizationId?`, and for Supabase sessions also
`sessionId`, `aal`, `amr` and `providers`. Two schemes, as in `gateway.yaml`. Cookies are never read.

| Scheme | Client | Check |
| --- | --- | --- |
| `Bearer cs_live_…` (`apiKey`) | VS Code | SHA-256 of the key matches an active (not revoked) row in `api_keys`; `lastUsedAt` is updated. The key's organization is the principal's |
| `Bearer <Supabase access token>` (`supabaseBearer`) | Dashboard (server side, `gatewayFetch`) | See below |

A Supabase access token is checked in this order (`auth/supabase-token.ts`, then the middleware):
1. **Signature and claims:** ES256 against the project's JWKS
   (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, fetched once and cached by `jose`), issuer
   `<SUPABASE_URL>/auth/v1`, audience `authenticated`, `exp` with 5 s tolerance, `role` must be
   `authenticated` (anon and service-role tokens are refused), and `sub` / `session_id` must be UUIDs.
   HS256 and unsigned tokens never verify. The reason for a rejection is logged, never returned.
2. **Session still live:** `private.session_is_active(session_id)`, so signing out (here or "on all
   devices") takes effect immediately, not when the token expires.
3. **User row:** the `users` row is inserted or refreshed from the claims (email, name, avatar,
   `last_seen_at`), at most once every 5 minutes per user. An email another row already holds is
   skipped rather than failing the sign-in.
4. **Organization:** the `X-Organization-Id` header, which must be one of the user's memberships;
   without it, the user's only membership. A new user has none until GitHub onboarding (A6).

API keys are opaque and never parsed as JWTs. Credentials are stored only as SHA-256 hashes; a
salted hash such as bcrypt would prevent the unique-hash lookup `schema.sql` uses, and the keys are
high-entropy random strings, not passwords. Without `SUPABASE_URL`, every non-`cs_live_` bearer is
`invalid_credentials`.

**Guards** (`auth/guards.ts`) for the routes that A6, A9 and A7 add: `requireUserSession` refuses API
keys on account and configuration routes, and `requireOrganization` refuses a caller with no
resolved organization.

| `code` | HTTP | When |
| --- | --- | --- |
| `unauthenticated` | 401 | No `Authorization` header |
| `invalid_credentials` | 401 | The bearer is not a known active API key or a valid Supabase token, or its user no longer exists |
| `session_revoked` | 401 | The token is valid but its Supabase session was signed out |
| `organization_forbidden` | 403 | `X-Organization-Id` names an organization the user is not a member of |
| `session_required` | 403 | An API key on a route that needs a signed-in session (`requireUserSession`) |
| `organization_required` | 403 | No organization could be resolved (`requireOrganization`) |
| `invalid_signature` | 401 | Webhook signature check failed (webhooks only) |

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
| `SUPABASE_URL` | unset | Supabase project URL; dashboard access tokens are verified against its JWKS. Unset → only API keys work | http or https URL; required when `NODE_ENV=production`. Signing in also needs `DATABASE_URL`, for the session check |
| `GITHUB_WEBHOOK_SECRET` | required | GitHub App webhook secret | at least 16 characters |
| `GATEWAY_SEED` | `none` | `dev` loads in-memory demo data | `none` or `dev`; `dev` is refused when `NODE_ENV=production` or with `DATABASE_URL` |
| `DATABASE_URL` | unset | Supabase Postgres (session pooler, port 5432, `prisma` role). Set → Prisma stores; unset → in-memory stores | `postgres://` or `postgresql://` URL; required when `NODE_ENV=production`; checked with `SELECT 1` at startup |
| `GITHUB_APP_ID` | unset | The GitHub App's numeric id | positive integer; set together with `GITHUB_PRIVATE_KEY_PATH`; required when `NODE_ENV=production` |
| `GITHUB_PRIVATE_KEY_PATH` | unset | The App's private key (`.pem`), relative to `services/gateway/` | read at startup; an unreadable file stops the gateway. `*.pem` is gitignored |
| `GITHUB_APP_CLIENT_ID` | unset | The App's client ID (General settings), for connecting GitHub | set together with the next two; all three required when `NODE_ENV=production`. Unset → the link routes answer 503 |
| `GITHUB_APP_CLIENT_SECRET` | unset | A client secret generated on the App's General settings | at least 20 characters |
| `FIELD_ENCRYPTION_KEY` | unset | Seals GitHub user tokens at rest (AES-256-GCM) | exactly 32 bytes, base64. Losing it means users connect GitHub again |
| `GATEWAY_DEV_REPOSITORY` | unset | Points the dev seed's repository at a real repo, e.g. `sumit-0804/code-sentinel-playground:1390792507` | `owner/name:githubRepoId` |

An empty value (`PORT=`) means "use the default". With `GITHUB_APP_ID` and
`GITHUB_PRIVATE_KEY_PATH` set, PR files come from GitHub through the App; without them, from a stub
(dev seed files, or none). Without `DATABASE_URL`, `GATEWAY_SEED=none` starts with empty stores.

`GATEWAY_SEED=dev` is for the local manual check without a database. It seeds one organization, the repository
`code-sentinel/consumer-api` (`githubRepoId` 123456789, every agent on its platform default mode,
platform threshold 0.8, default branch `main`), the user `octo-dev` with the API key **`cs_live_dev_00000000`** (`DEV_API_KEY`), and a GitHub
stub whose pull requests contain `payments/retry_queue.py` (reviewed), `package-lock.json`
(`generated_file`) and `logo.png` (`binary`).

## Persistence

`server.ts` picks the stores at startup and the `gateway listening` line says which (`stores`):

| `DATABASE_URL` | Stores | Data |
| --- | --- | --- |
| set | `PrismaStores` over [`@code-sentinel/db`](../../packages/db/README.md) | the Supabase tables; seed a dev database with `npm run seed -w @code-sentinel/db` |
| unset | `InMemoryStores` | empty, or the dev seed with `GATEWAY_SEED=dev` |

Both implement the interfaces in `persistence/stores.ts`, resolve repository settings with the same
`resolveEffectiveConfig()` (`persistence/effective-config.ts`), and pass the same contract suite
(`test-support/stores-contract.ts`): in memory on every run, and against Postgres in
`prisma-stores.integration.test.ts` when `TEST_DATABASE_URL` is set (CI). That suite writes rows
with fresh random ids and deletes them afterwards, so it can also run against Supabase dev.

Differences to know:
- `organizations.default_confidence_threshold` is `NOT NULL DEFAULT 0.800`, so with a database the
  threshold source is never `platform_default`; only the in-memory stores reach it.
- Sessions belong to Supabase (`auth.sessions`). `PrismaStores.sessions.isActive` calls
  `private.session_is_active(uuid)`, a `security definer` function created by hand in each Supabase
  project (only `prisma` may run it; see `packages/db`). A test database has no `auth` schema, so the
  integration test installs a stand-in backed by `private.test_sessions`. It never replaces a real
  function, and against Supabase the session cases are skipped. In memory, `activeSessionIds` lists
  the live sessions, so without a database a real dashboard session is never accepted.
- `users.recordSignIn` upserts by id and leaves memberships alone.
- Installations and repositories are upserted by their GitHub ids. `repositories.removed_at` marks a
  repository that left its installation (names are unique only among active rows, so a recreated
  repository can reuse one). A GitHub login now held by a different account id is renamed aside
  (`login~<id>`), because logins can be reused after a rename.
- `/healthz` adds `dependencies.database` (`ok` or `unavailable`, from `SELECT 1` within 2 s); anything
  but `ok` makes the gateway `degraded`.

## Not started yet

- `/v1/reviews`: create (on-demand), list, get, SSE events, style fixes
- Findings accept / reject (`/v1/findings/{findingId}/suggestion/...`)
- API-key management (`/v1/me/api-keys`)
- Rate limiting (FR-GW-05)
- Storing Check Run and comment ids (`reviews.github_check_run_id`, `suggestions.github_comment_id`); the orchestrator writes `reviews` in Phase A3
- Accept / reject tracking of posted suggestions (UC-3)
- Cancelling a superseded job when a new commit is pushed
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

223 tests in 21 files (29 are the Prisma suite, which runs when `TEST_DATABASE_URL` is set; locally,
point it at the Docker Postgres in the [db README](../../packages/db/README.md)). They run
the real app on an ephemeral port (`withServer` from `@code-sentinel/service-kit/testing`) with global
`fetch`, stub the orchestrator and GitHub, sign Supabase tokens with a local ES256 key and JWKS
(`test-support/supabase-tokens.ts`), and never need a real secret, port 3000 or the network.

**Manual check** (Git Bash, from `services/gateway/` after `npm run build` at the root):

1. Start the real orchestrator on port 8080 with `SERVICE_TOKEN=local-service-token` (see the
   orchestrator README's manual check), or any fake that answers `202` with a `ReviewJob` and
   `200 {"status":"ok"}` on `/healthz`.
2. Start the gateway. These variables override `.env`, so the webhook secret below is known:
   ```bash
   PORT=3000 ORCHESTRATOR_URL=http://127.0.0.1:8080 SERVICE_TOKEN=local-service-token \
   GITHUB_WEBHOOK_SECRET=local-webhook-secret GATEWAY_SEED=dev node dist/server.js
   ```
3. Write a `pull_request.opened` payload for repository id 123456789 to a file, sign it with
   `sha256=` + HMAC-SHA256(`local-webhook-secret`, file bytes), and `curl --data-binary @file`
   with `X-GitHub-Event: pull_request`, `X-GitHub-Delivery` and `X-Hub-Signature-256`. Expect 202
   `review_started`, and a job on the orchestrator with one file and two skipped files.
4. Send the same body signed with a wrong secret, with no signature, and `{not json` unsigned:
   each is 401 `invalid_signature` and the orchestrator receives nothing.
5. `curl /v1/me` is 401 `unauthenticated`; with `Authorization: Bearer cs_live_dev_00000000` it is
   200. `curl /healthz` is `ok`, and `degraded` / `unavailable` once the orchestrator stops.

**Sign-in check with the dashboard** (Supabase dev project): start the gateway with `DATABASE_URL`
(the `prisma` role) and `SUPABASE_URL=https://<project-ref>.supabase.co`, and the dashboard with
`GATEWAY_URL=http://localhost:3000`. Sign in, open **Settings**: the Organizations section comes
from `/v1/me` through the gateway, and the `users` row now exists. Sign out of all devices in
another browser; this browser's next gateway call is 401 `session_revoked`.

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
     Organization permissions: **Members: Read** (tells org admins from members when connecting).
   - Subscribe to events: **Pull request**. GitHub sends `installation` and
     `installation_repositories` to every App without a subscription.
   - Where can it be installed: **Any account**, so organizations and teammates can install it.
   - **Identifying and authorizing users:** Callback URL `http://localhost:3001/onboarding/github/callback`
     (the dashboard), **Expire user authorization tokens** on, **Request user authorization (OAuth)
     during installation** on.
   - **Post installation:** Setup URL the same callback, **Redirect on update** on.
3. On the App page: note the **App ID** and **Client ID**, **Generate a new client secret**, then
   **Generate a private key** and save the `.pem` as `services/gateway/github-app.pem`.
4. **Install App** from the dashboard (Repositories → **Add repositories**), or from GitHub on
   `code-sentinel-playground` and then **Connect GitHub** in the dashboard.
5. In `services/gateway/.env`: `GITHUB_APP_ID=<id>`, `GITHUB_PRIVATE_KEY_PATH=github-app.pem`,
   `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` and `FIELD_ENCRYPTION_KEY` (see
   [Configuration](#configuration)), and in `apps/dashboard/.env.local` `GITHUB_APP_SLUG` and
   `GITHUB_APP_CLIENT_ID`. Then either of these:
   - **In memory:** `GATEWAY_SEED=dev`, `GATEWAY_DEV_REPOSITORY=sumit-0804/code-sentinel-playground:1390792507`.
   - **With Supabase dev:** `GATEWAY_SEED=none` and `DATABASE_URL=<session pooler URL>`. Then seed the
     repository once: set `SEED_GITHUB_REPOSITORY=sumit-0804/code-sentinel-playground:1390792507` in
     `packages/db/.env` and run `npm run seed -w @code-sentinel/db`. `/healthz` then shows
     `"database":"ok"`.

**Each run:**

```bash
npx smee-client --url <smee channel URL> --target http://127.0.0.1:3000/webhooks/github
```

Start the orchestrator, the Security and Style agents, and the gateway (see the root README), then
open a pull request from `demo/risky-change` to `main` in the playground. The gateway log shows
`review_started` with the real files, and the orchestrator job ends with Security findings (SQL
injection, the AWS key, `innerHTML`) and Style findings with Prettier fixes. **Redeliver** from the
App's *Advanced → Recent Deliveries* page gives `duplicate_ignored`; a new push gives a new job.

The database setup was run live on 11-Oct (playground PR #4): the gateway logged `stores: postgres`,
found the playground repository and its settings in Supabase dev, and posted "2 critical · 5 info"
with 4 inline comments, the same result as the in-memory runs.

