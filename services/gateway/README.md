# @code-sentinel/gateway

The API gateway: the single Express entry point for the GitHub App and the dashboard (FR-GW-01).
It verifies GitHub webhooks (FR-GW-03), authenticates signed-in dashboard sessions (FR-GW-02), and forwards review jobs to the orchestrator, relaying its answer (FR-GW-04).

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
| Auth middleware + `GET /v1/me` (FR-GW-02) | `auth/authenticate.ts`, `auth/supabase-token.ts`, `routes/me.ts` | working: Supabase access tokens; see [Authentication](#authentication) |
| Route guards | `auth/guards.ts` (`requireOrganization`, `assertOrgAdmin`, `assertStepUp`) | used by the GitHub, repository and organization routes |
| Connecting GitHub (A6) | `routes/github.ts`, `github/github-user-client.ts`, `github/installation-sync.ts` | working; see [Connecting GitHub](#connecting-github) |
| `GET /v1/repositories` | `routes/repositories.ts` | working: the organization's active repositories |
| Review history (A4b-2) | `routes/reviews.ts`, `routes/review-view.ts` | working: `GET /v1/reviews`, `GET /v1/reviews/{id}`; see [Review history](#review-history) |
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
| 9 | Every PR file filtered out; no orchestrator call, but a neutral **"Nothing to review"** Check Run lists the skipped files | 202 | `event_ignored` | `no_reviewable_files` |
| 10 | Orchestrator answers 202 | 202 | `review_started` + `reviewId` | `review_started` |
| 10 | Orchestrator answers 200 (job exists for this delivery) | 202 | `duplicate_ignored` + `reviewId` | `duplicate_ignored` |
| 10 | Orchestrator timed out, unreachable, non-2xx or invalid body | 502 | `orchestrator_unavailable` (`details.kind`, `details.status`) | `orchestrator_unavailable` |

The job is sent with `Idempotency-Key` = the delivery id and `X-Request-Id` = the request id, so a
GitHub redelivery after a 502 cannot start a second review. The gateway never looks at the PR
author, so external contributors take the same path (AC-10). The request log line carries
`deliveryId`, `event`, `action`, `repository`, `files`, `skippedFiles` counts and `outcome`.

**A newer commit replaces the running review.** After a new review starts, the gateway cancels the
pull request's other queued or running reviews of an older commit
(`POST /internal/v1/review-jobs/{id}/cancel`, found through `ReviewStore.activeForPullRequest`).
- Their Check Runs complete as neutral **"Superseded by a newer commit"**, with no inline comments.
- A failed cancel is logged and never affects the new review.
- When the newer review completes, the orchestrator marks the older reviews' undecided fixes
  `superseded`, including ones committed with GitHub's own "Commit suggestion" button.

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
   existing role is never lowered. Someone else's personal account is reached as a collaborator, so its
   role is `member`.
   - **A member's repositories:** for a `member`, the sync also asks GitHub which of the installation's
     repositories this user can open (`GET /user/installations/{id}/repositories`, as the user) and
     writes them to `repository_members`. Admins have no rows and see every repository.
4. `GET /v1/installations` lists the user's installations, and `GET /v1/repositories` an organization's
   active repositories (`X-Organization-Id`, or the only membership).
   - **What a member sees:** only their own repositories. That covers the list, configuration, reviews,
     pull requests and fixes (`RepositoryScope` from `scopeOf(principal)`); any other repository is 404, like
     an unknown one.
   - **Fails safe:** a member who hasn't synced since `repository_members` was added sees none. Access
     follows GitHub as of the member's last sync, so someone removed as a collaborator keeps access until
     their next sync, and a repository added to the App later stays hidden from members until then.

Repositories are matched by GitHub id, so a rename updates the name in place. A repository that leaves
its installation is **marked removed, never deleted**, and comes back with its history if added again.

| `code` | HTTP | When |
| --- | --- | --- |
| `github_code_invalid` | 400 | GitHub refused the code (used, expired, or for another App) |
| `github_account_taken` | 409 | The GitHub account is linked to another user |
| `github_not_linked` | 409 | Sync without a stored token, or the refresh token has run out |
| `github_unavailable` | 502 | GitHub did not answer during the exchange or the sync |
| `github_link_unconfigured` | 503 | `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` or `FIELD_ENCRYPTION_KEY` not set |

`link` and `sync` need a TOTP step-up from a user with an authenticator app (403 `mfa_required`, see [Authentication](#authentication)).

## Repository configuration

How each repository is reviewed (A9, UC-4). Every agent has a **mode**:

| Mode | Runs | Posts findings | Fails the Check Run on a critical finding | Fails it on a warning |
| --- | --- | --- | --- | --- |
| `off` | no | no | no | no |
| `comment` | yes | yes | yes | no |
| `block` | yes | yes | yes | yes |

**Where values come from** (`resolveEffectiveConfig()`, `persistence/effective-config.ts`):
- **Agent modes:** while `repositories.use_org_defaults` is true (the default), from the organization's
  review defaults (`organization_agent_defaults`); otherwise from the repository's own rows
  (`repository_agent_config`). An agent with nothing set uses the **platform default: `block` for Security,
  `comment` for the rest**.
- **Confidence threshold:** the repository override, then the organization default, then 0.8 (unchanged).
- **Branches to review:** always the repository's own (`repository_settings.review_branches`), whatever
  `use_org_defaults` says; organizations don't set branches. Names or globs a pull request must merge **into** (`main`, `release/*`,
  `hotfix/**`), matched with `picomatch`: case-sensitive, `*` is one path segment and `**` any number
  (so `**` means every branch). Nothing set means the repository's default branch only. Up to 20
  patterns of 1–100 characters, no spaces or `..`.

**API** (`gateway.yaml`):

| Route | Who |
| --- | --- |
| `GET /v1/repositories/{id}/config` | any member; another organization's repository is 404 |
| `PUT /v1/repositories/{id}/config` | a signed-in **admin** of the repository's organization |
| `GET /v1/organizations/{id}/review-defaults` | any member |
| `PUT /v1/organizations/{id}/review-defaults` | a signed-in **admin** of that organization |

Both `PUT`s are partial updates (omitted fields keep their value) and answer with the new
configuration. The repository `PUT` also takes `reviewEnabled` and `useOrgDefaults`, and
`confidenceThresholdOverride: null` restores inheritance. Errors: 400 `invalid_body` (with zod's
`issues`), 400 `no_agents_enabled` when every agent would end up `off` (switch reviews off instead),
403 `admin_required` for a member, and 403 `mfa_required`
without a recent authenticator code, for someone who has set one up (see [Step-up](#authentication)). Each row written records `updated_by`.

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
`py` → `python`, anything else → `unknown`, which is still sent (the Security Agent scans it for
secrets; the others skip it as `unsupported_language`).

**Files sent to the agents** (`webhooks/file-contents.ts`, for both the webhook and a re-run). The
agents read each change in context, so each kept file that isn't deleted is read whole at the head
commit (`GET /contents`) and sent as `ChangedFile.content` next to its diff:
- **Size cap:** a file over `FILE_CONTENT_MAX_BYTES` (36 000 by default, about one LLM call) goes
  as its diff only. `0` turns whole files off.
- **Concurrency:** 5 reads at a time. No new read starts after 4 s, because GitHub expects the
  webhook's answer within 10 s.
- **Failures:** a missing or unreadable file goes without `content`, with a warning. The review
  never fails because of it.
- **Logging:** the `changed files read` log line counts `attached`, `oversized`, `failed` and
  `outOfTime`.

Only the pull request's changed files are sent, never the rest of the repository (NFR-06).

## Review history

The orchestrator writes every review to `reviews`, with the full `CombinedReport` in `report`. The gateway reads
them back for the dashboard; both routes take a Supabase session and only ever show the caller's organization (another organization's review is 404, like an unknown one).

- **`GET /v1/reviews`**, newest first:
  - `repositoryId`, `status` (comma-separated), `limit` (1–100, default 25) and `offset`
  - **`latest=true`** keeps each pull request's newest review, one row per pull request, whether a push or a
    dashboard re-run started it
  - each item carries the severity counts, the stored Check Run conclusion, and **`agentResults`**: each agent's
    worst finding at or above the review's threshold (`critical` … `clean`, or `not_run` / `running`)
  - a bad filter is 400 `invalid_query`
- **`GET /v1/reviews/{id}`**: the `CombinedReport` plus the repository, trigger, PR title, refs, conclusion and
  `createdAt`. While a review is still running it has no report yet, so the answer is an empty one with the row's
  status. `agentRuns` then lists the agents that have answered so far (`reviews.agent_progress`, written by the
  orchestrator), and `startedAt` says when the agents started, so the dashboard can show live progress.
- **The database's `cancelled` status** is reported as `failed`, since the API has no `cancelled`.

When the publisher completes a Check Run it also stores its id and conclusion on the review
(`github_check_run_id`, `check_conclusion`: `pass` / `fail` / `neutral`), so the dashboard shows the same verdict
as GitHub. If that write fails, it's logged and the Check Run stands.

## Open pull requests and re-running a review

These routes are scoped to the caller's organization; another organization's repository is 404
`repository_not_found`.

**`GET /v1/repositories/{id}/pulls`** (any member):
- The repository's open pull requests from GitHub, read with the App's installation token: up to 50, most recently
  updated first. GitHub's answer is cached for 30 s per repository.
- Each pull request carries its newest review (`latestReview`, or `null`) and `reviewable`, whether its base branch
  is one of the [branches to review](#repository-configuration).
- GitHub failing is 502 `github_unavailable`.

**`GET /v1/repositories/{id}/branches`** (any member), for the dashboard's branch picker:
- The repository's branch names from GitHub, A–Z, up to 300; `truncated` is true when there are more. Paging stops at
  the limit, and the answer is cached for 60 s per repository.
- GitHub failing is 502 `github_unavailable`; the dashboard then falls back to typing a name.

**`POST /v1/reviews`** with `{ repositoryId, pullRequestNumber }` (the dashboard's "Re-run review"):
- **Who:** any member of the organization. Any other body is 400 `invalid_body`.
- **What it reviews:** the open pull request's head commit, through the same path as the webhook
  (`webhooks/start-review.ts`: files, filter, job, follow), with trigger `dashboard_manual` and `triggered_by_user_id`.
  - Re-running the same commit is allowed: the one-review-per-commit rule only covers `github_pull_request`.
  - An older review of that pull request that is still running is cancelled ("Superseded by a newer commit").
- **Answers:** 202 `{ reviewId, status }`, or:

  | HTTP | `code` | When |
  | --- | --- | --- |
  | 404 | `pull_request_not_found` | The pull request isn't open on GitHub |
  | 409 | `repository_disabled` | Reviews are off, or every agent is off |
  | 409 | `branch_ignored` | Its base branch isn't reviewed |
  | 409 | `review_in_progress` | A review of that pull request started less than 30 s ago, so a double click runs one review |
  | 422 | `no_reviewable_files` | Every file is skipped; the "Nothing to review" Check Run is posted |
  | 502 | `github_unavailable`, `orchestrator_unavailable` | GitHub or the orchestrator failed |

## Accepting or rejecting a fix (UC-3)

A finding's fix is a `suggestions` row the orchestrator writes as `proposed`.
- **Comment ids:** after posting the inline comments, the publisher reads them back from the pull request's
  comment list (`GET …/pulls/{n}/comments`; the per-review list leaves the line numbers empty) and stores each
  fix's comment id (`posted_to_github`, `github_comment_id`), matched by file and line range (`matchPostedComments`),
  for the fixes actually put in a comment (one per place).
- **Review detail:** `GET /v1/reviews/{id}` adds each fix's row to its finding: `id` (the finding id) and
  `suggestion.id`, `state`, `commitSha` or `rejectionReason`.

**`POST /v1/findings/{findingId}/suggestion/accept`** (FR-GH-04, the only way Code Sentinel writes to a branch):
- **Who:** any member of the finding's organization, with a signed-in session and the [TOTP step-up](#authentication),
  because it writes code.
- **What it checks** (`github/apply-suggestion.ts`), each a 409 when it fails:
  - the fix is still `proposed` (`suggestion_decided`)
  - the pull request is open (`pull_request_closed`) and not from a fork (`fork_not_supported`, as the App can't
    push there)
  - its head is still the reviewed commit (`head_moved`)
  - lines `lineStart..lineEnd` of the file at that head still equal `originalSnippet` (`file_changed`)
- **What it does:**
  1. Replaces those lines with `suggestedSnippet`, keeping the file's line endings.
  2. Commits it onto the branch with the Contents API ("Apply Code Sentinel fix: …"). Without Contents: Read and
     write, the commit fails and the answer is 409 `github_permission_missing`.
  3. Replies "Applied in {sha}" on the fix's inline comment, if it had one.
  4. Records `accepted`, `resolved_by_user_id`, `resolved_at` and `resolution_commit_sha`.
- **After:** the commit is a push, so the pull request is reviewed again, and that review marks the older fixes
  `superseded`.

**`POST /v1/findings/{findingId}/suggestion/reject`** `{ reason?, comment? }`:
- **Who:** any member, with a signed-in session. No step-up, since nothing is written to the repository.
- **What it does:** records `rejected` with `rejection_reason` and `rejection_comment` (at most 1000 characters).
  It's 409 `suggestion_decided` if the fix was already decided.

Each decision is written only while the fix is `proposed`, so two people deciding at once can't both win.

**Apply all fixes** (`github/apply-all-fixes.ts`): every open fix of a review in **one commit**. "Open" means
`proposed`, for the reviewed commit, and its finding was posted (at or above the threshold).
- **Where:** an **Apply all fixes** button on the Code-Sentinel Check Run, shown only while the review has open fixes
  ("N fixes (M AI) in one commit"). Clicking it sends a `check_run` `requested_action` webhook (`apply_all`); the
  gateway finds the review by its Check Run id, answers 202 `fixes_applying` and commits in the background. GitHub
  only offers the button to people with write access. The dashboard's **Apply all fixes** on the PR page calls
  **`POST /v1/reviews/{id}/apply-all-fixes`** (any member, with the TOTP step-up; 404 `review_not_found`, 409 with the
  codes above or `nothing_to_apply`), which answers `{ reviewId, commitSha, applied, aiApplied, skipped }`.
- **What it includes:** Style's exact fixes **and** the AI-suggested fixes of Security, Logic, Performance and
  Documentation. This was a deliberate change on 16 Oct: AI fixes used to be one click each (FR-GH-04, NFR-07). The
  button is still a person's action and says how many AI fixes it carries; single-fix commit and dismiss are unchanged.
- **Who:** an accepted AI fix must name the person who accepted it (`ck_ai_fix_needs_action`). From GitHub's button, the
  gateway looks up the clicker's GitHub id among linked Code Sentinel users (`UserStore.findByGithubId`) who are
  members of the review's organization. A collaborator with no account here gets **only the exact Style fixes**, and the
  comment says how many AI fixes were left and why; with only AI fixes open, nothing is committed and the comment
  explains. With `DASHBOARD_URL` set, the comment links to sign-in and to the review's page. The dashboard always has the signed-in user. `SuggestionStore.accept` without a user only ever accepts an
  exact fix, in both stores.
- **Checks:** the same as one fix (open, not a fork, still the reviewed head). Where two fixes touch the same lines,
  the one higher in Security > Logic > Performance > Style > Documentation wins; a fix whose lines changed is skipped.
- **How:** each file is edited bottom-up, then one commit through the Git Data API (tree with each file's mode kept,
  commit on the reviewed head, branch moved without force, so a push in between makes it fail as `head_moved`).
- **After:** each applied fix is `accepted` with the commit sha and the user (none for an exact fix applied by an unlinked collaborator), and **one**
  comment on the pull request lists what was applied and what was skipped. The commit is a push, so the pull request
  is reviewed again.
Another organization's finding, an unknown one, or one without a fix is 404 `finding_not_found`.

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
   `postInlineComments` on. It covers the findings at or above the repository's confidence threshold
   (0.8 by default, FR-ORC-06) that either carry a fix or come from the Security, Logic or
   Performance agent, with **one inline comment per place**: findings in the same file on
   overlapping lines share a comment (`review-output.ts`):
   - the comment starts "**Flagged by Security and Logic**" when more than one agent is there, then
     each agent's note by severity, including the agents of a finding the orchestrator clubbed
     (`alsoReportedBy`);
   - when the orchestrator found similar past issues in the organization (vector context), one line
     says so: "_Seen before: 2 similar issues; closest in acme/api#12 (Fixed in abc1234)._";
   - it carries **at most one fix**, picked Security > Logic > Performance > Style > Documentation, and
     spans exactly that fix's lines, so committing it replaces the right ones. Other fixes there are
     mentioned ("Another fix (Style) is on the Code Sentinel dashboard") and can be committed from
     the PR page; only the posted fix is paired with the comment's id (`postedFixes`);
   - a fix is a ```` ```suggestion ```` block the author commits with one click; Style's
     Prettier/Black fixes are labelled deterministic, the LLM fixes of the Security, Logic,
     Performance and Documentation agents AI-suggested (review before committing). Nothing is
     pushed to the branch unless someone accepts a fix (FR-GH-04, UC-3 below);
   - Style lint findings without a fix are not posted inline; they are Check Run annotations;
   - at most 50 comments (places), highest ranked first; the rest are counted in the Check Run;
   - if GitHub refuses the review (422, a line it will not accept), each comment is posted on its
     own and the ones still refused are listed in the Check Run summary.
4. **Complete the Check Run** (FR-GH-02):

   | Conclusion | When |
   | --- | --- |
   | `failure` | a finding at or above the threshold is `critical` (from any agent, whatever its mode), or is a `warning` from an agent in `block` mode (any of a clubbed finding's agents); also on a partial review |
   | `neutral` | otherwise, when the review is `partial`, `failed`, `cancelled`, or did not finish in time |
   | `success` | otherwise |

   The summary says which agents blocked the merge and with how many critical findings and
   warnings, then the counts by severity, "N findings in M places" when some share a place, coverage (files and changed lines), one line per agent
   (✅ findings and provider, ⚠️ no result, ⏸️ LLM analysis deferred, ➖ not configured), skipped
   files with reasons, how many findings fell below the threshold, and any posting problems.
   Every finding at or above the threshold is an annotation on its lines (`failure` / `warning` /
   `notice`), sent 50 per request. When the review left open fixes, the Check Run gets an **Apply all fixes**
   button ([below](#accepting-or-rejecting-a-fix-uc-3)).

If the Check Run cannot be created (for example a missing permission), the review is still
posted and the failure is logged with the request id.

## Authentication

`/v1` routes pass through `createAuthMiddleware`, which reads `Authorization: Bearer <token>` and
sets `res.locals.principal`: `userId`, `organizationId?`, `sessionId`, `aal`, `amr` and `providers`.
The only scheme is `supabaseBearer`, as in `gateway.yaml`: a Supabase access token the dashboard sends
from its server (`gatewayFetch`). Cookies are never read.

The token is checked in this order (`auth/supabase-token.ts`, then the middleware):
1. **Signature and claims:** ES256 against the project's JWKS
   (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, fetched once and cached by `jose`), issuer
   `<SUPABASE_URL>/auth/v1`, audience `authenticated`, `exp` with 5 s tolerance, `role` must be
   `authenticated` (anon and service-role tokens are refused), and `sub` / `session_id` must be UUIDs.
   HS256 and unsigned tokens never verify. The reason for a rejection is logged, never returned.
2. **Session still live:** `private.session_is_active(session_id)`, so signing out (here or "on all
   devices") takes effect immediately, not when the token expires.
   - **Authenticator app:** in the same round trip, `private.user_has_totp(sub)` says whether the user has
     set one up (`principal.mfaEnrolled`). Signing in never needs its code; only the step-up routes below do.
3. **User row:** the `users` row is inserted or refreshed from the claims (email, name, avatar,
   `last_seen_at`), at most once every 5 minutes per user. An email another row already holds is
   skipped rather than failing the sign-in.
4. **Organization:** the `X-Organization-Id` header, which must be one of the user's memberships;
   without it, the user's only membership. A new user has none until GitHub onboarding (A6).

Without `SUPABASE_URL`, every bearer is `invalid_credentials`.

**Guards** (`auth/guards.ts`):
- `requireOrganization` refuses a caller with no resolved organization.
- `assertOrgAdmin` needs the organization's admin role on configuration writes.
- `assertStepUp` is the TOTP step-up (A7), described below.

**Step-up (A7).** These writes change what Code Sentinel reviews or can access. For a user who has set up
an authenticator app, they need a code entered within `MFA_STEP_UP_MINUTES` (10). A user without one
isn't asked: there is no code to give. Fixes, re-runs and signing out a device use the same check.
- `PUT /v1/repositories/{id}/config`
- `PUT /v1/organizations/{id}/review-defaults`
- `POST /v1/github/link`
- `POST /v1/installations/sync`

For a user with an authenticator app, the check reads the token:
- it must be `aal2`
- its `amr` must have a `totp` entry whose `timestamp` is no older than the limit

Entering a code (`mfa.challenge` + `mfa.verify` in the dashboard) gives the session a new token like
that. The admin check runs first, so members aren't asked for a code they can't use.

| `code` | HTTP | When |
| --- | --- | --- |
| `unauthenticated` | 401 | No `Authorization` header |
| `invalid_credentials` | 401 | The bearer is not a valid Supabase token, or its user no longer exists |
| `session_revoked` | 401 | The token is valid but its Supabase session was signed out |
| `organization_forbidden` | 403 | `X-Organization-Id` names an organization the user is not a member of |
| `organization_required` | 403 | No organization could be resolved (`requireOrganization`) |
| `admin_required` | 403 | A configuration write by someone who isn't an admin of the organization (`assertOrgAdmin`) |
| `mfa_required` | 403 | Only for a user with an authenticator app: a step-up route without a code from the last `MFA_STEP_UP_MINUTES` (`assertStepUp`) |
| `invalid_signature` | 401 | Webhook signature check failed (webhooks only) |

## Signed-in devices

`GET /v1/me/sessions` lists the caller's live Supabase sessions, most recently active first, with
`current` on the one making the request. The browser and IP are the gateway's own record
(`session_activity`): Supabase only sees the dashboard's server, because sign-in and token refresh run
there, so the auth middleware stores each session's `req.ip` and `User-Agent` (forwarded by the
dashboard, see `TRUST_PROXY`) at most once a minute, or at once when they change. A failed write is
logged and never fails the request. A session the gateway hasn't seen yet shows Supabase's values.
`DELETE /v1/me/sessions/{id}` signs one out at once (its next request is 401 `session_revoked`, and its
refresh tokens are gone): TOTP step-up, 409 `current_session` for this device (sign out instead), 404
for another user's or an unknown session. Recorded in the audit log as `session_revoked`.

## Agent health

`GET /v1/agents/health` (any signed-in user) relays the orchestrator's
`/internal/v1/agents/health`: per agent `ok`, `degraded`, `asleep` (a sleeping free-tier agent the
orchestrator is waking; the orchestrator's `asleep: true`) or `unavailable` (also an agent with no URL),
with `latencyMs` and `checkedAt`. One answer is reused for 15 seconds, so a burst of dashboard pages
makes one call. When the orchestrator doesn't answer, every agent is `unknown` and the reason is
logged. The dashboard uses it for the agent notices (`routes/agents-health.ts`).

## Audit log

`audit/audit-log.ts` writes `audit_events` (`AuditStore`) for every sensitive action, with the user,
the client IP (`req.ip`, so `TRUST_PROXY` matters), the browser's user agent and the request id. An
entry never fails or delays the action: a failed write is logged as "audit event not recorded".

| Action | Written by |
| --- | --- |
| `repository_config_updated`, `repository_reviews_toggled` | `PUT /v1/repositories/{id}/config` (`toggled` when only `reviewEnabled` changed); `metadata.changed` lists the fields |
| `review_defaults_updated` | `PUT /v1/organizations/{id}/review-defaults` |
| `fix_accepted`, `fix_rejected` | the suggestion accept and reject routes |
| `fixes_applied` | Apply all fixes, from the dashboard or the Check Run button (`metadata.via: "check_run"` and the clicker's `githubLogin`; no `userId` when they have no account here) |
| `review_rerun` | `POST /v1/reviews` when a review starts |
| `github_linked`, `installations_synced` | GitHub link and sync, once per organization the sync reached |
| `step_up_refused` | any `/v1` write answered 403 `mfa_required` (method and path in `metadata`) |
| `session_revoked` | `DELETE /v1/me/sessions/{id}` |

`GET /v1/organizations/{id}/audit-events?before=&limit=` returns them newest first for the
organization's **admins** (403 `admin_required` for members, 404 for another organization), with
`actor` (name, GitHub login or email) and `nextBefore` for the next page.

Every `/v1` request log line also carries `ip`, `userAgent` and, once authenticated, `userId` and
`sessionId`.

## Metrics

`GET /metrics` serves Prometheus text behind `Authorization: Bearer <METRICS_TOKEN>` (401 without it; not
mounted when the variable is unset), for Grafana Cloud. Every series carries `service="gateway"`:

- `http_request_duration_seconds{method,route,status}`, by route pattern (`/v1/reviews/:reviewId`), from
  `@code-sentinel/service-kit`
- `webhook_deliveries_total{event,outcome}`: the outcome the request log records (`review_started`,
  `event_ignored`, `repository_disabled`, ..., or `rate_limited`)
- `rate_limited_total{limiter}`: `webhook`, `failed_auth`, `user` or `write`
- process metrics (CPU, memory, event loop lag)

## Rate limits (FR-GW-05)

`http/rate-limits.ts`, on `express-rate-limit`. Every limit answers **429 `rate_limited`** with
`Retry-After` (seconds) and the draft-7 `RateLimit` headers.

| Limiter | Key | Default | Where |
| --- | --- | --- | --- |
| Webhooks | the payload's installation id | 300 / min | after the signature check, so a forged delivery never counts |
| Failed sign-ins | client IP | 20 / 15 min, only requests answered 401 | before authentication on `/v1`, so a token-guessing IP stops costing JWKS checks |
| Signed-in users | user id | 120 / min | every `/v1` request after authentication |
| Writes | user id | 20 / min | `POST`, `PUT`, `PATCH`, `DELETE` on `/v1`: configuration, fix commits, re-runs, syncs |

- Counters live in the gateway's memory, which fits one instance; more instances need a shared store.
- The dashboard calls the gateway from its server and forwards the browser's IP (`X-Forwarded-For`) and
  user agent. `TRUST_PROXY` must count every hop in front of the gateway, the dashboard included: 1
  locally, 4 on Render (Cloudflare at Render's edge, two Render proxies, the dashboard; measured 20 Oct with
  the failed sign-in counter). Too low and every user shares a proxy's IP (Cloudflare's, at 2);
  too high and a direct caller can pick its own IP. The per-user limits are keyed by user id, so a
  forged `X-Forwarded-For` only affects the failed sign-in limit.
- Sign-in, password reset and TOTP verification happen in Supabase Auth, called by the dashboard,
  and are limited by Supabase's own Auth rate limits (project settings → Rate Limits).

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
| `MFA_STEP_UP_MINUTES` | `10` | How long an authenticator code counts for on step-up routes | integer 1..60 |
| `FILE_CONTENT_MAX_BYTES` | `36000` | Changed files up to this size go to the agents whole; larger ones as diffs only. `0` sends diffs only | integer 0..1000000 |
| `RATE_LIMIT_WEBHOOK_PER_MIN`, `RATE_LIMIT_USER_PER_MIN`, `RATE_LIMIT_WRITE_PER_MIN` | `300`, `120`, `20` | Webhook deliveries per installation, `/v1` requests and `/v1` writes per user, per minute | integer 1..100000 |
| `RATE_LIMIT_FAILED_AUTH_PER_15_MIN` | `20` | Requests answered 401 per IP address per 15 minutes | integer 1..100000 |
| `TRUST_PROXY` | `0` | Proxy hops in front of the gateway, counting the dashboard (1 locally, 4 on Render), so `req.ip` is the browser's | integer 0..10 |
| `METRICS_TOKEN` | unset | Bearer token for `GET /metrics`; unset → no such route | at least 16 characters |
| `SUPABASE_URL` | unset | Supabase project URL; dashboard access tokens are verified against its JWKS. Unset → every `/v1` call is 401 | http or https URL; required when `NODE_ENV=production`. Signing in also needs `DATABASE_URL`, for the session check |
| `DASHBOARD_URL` | unset | The dashboard's base URL. Set → the Apply all fixes comment links to the review's page (`/pull-requests/{reviewId}`) and to sign-in | http or https URL; a trailing slash is ignored |
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
platform threshold 0.8, default branch `main`), the user `octo-dev`, and a GitHub
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
- Sessions belong to Supabase (`auth.sessions`). `PrismaStores.sessions` calls
  `private.session_is_active`, `private.user_sessions` and `private.revoke_session`, `security definer`
  functions created by hand in each Supabase project (only `prisma` may run them; the SQL is in
  [`packages/db`](../../packages/db/README.md), Supabase setup step 4). A test database has no `auth`
  schema, so the integration test installs stand-ins backed by `private.test_sessions`. They never
  replace real functions, and against Supabase the session cases are skipped. In memory, `activeSessionIds` lists
  the live sessions, so without a database a real dashboard session is never accepted.
- `users.recordSignIn` upserts by id and leaves memberships alone.
- Installations and repositories are upserted by their GitHub ids. `repositories.removed_at` marks a
  repository that left its installation (names are unique only among active rows, so a recreated
  repository can reuse one). A GitHub login now held by a different account id is renamed aside
  (`login~<id>`), because logins can be reused after a rename.
- `/healthz` adds `dependencies.database` (`ok` or `unavailable`, from `SELECT 1` within 2 s); anything
  but `ok` makes the gateway `degraded`.

## Not started yet

- `/v1/reviews`: SSE events; the list's `minSeverity`, `trigger`, `from` and `to` filters and the detail's `agent` filter

## Develop

```bash
npm install                             # from the repo root
npm run test                            # Turborepo builds contracts and service-kit first, then runs every test
npm run test  -w @code-sentinel/gateway # needs a prior build of contracts and service-kit
npm run build -w @code-sentinel/gateway
npm run lint  -w @code-sentinel/gateway
```

296 tests in 28 files (37 are the Prisma suite, which runs when `TEST_DATABASE_URL` is set; locally,
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
5. `curl /v1/me` is 401 `unauthenticated` (signing in needs Supabase; see the sign-in check below).
   `curl /healthz` is `ok`, and `degraded` / `unavailable` once the orchestrator stops.

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

1. Settings → Developer settings → GitHub Apps → **New GitHub App**:
   - Homepage URL: the Code-Sentinel repo URL. Webhook URL: the deployed gateway,
     `https://api.codesentinel.scribly.fun/webhooks/github` (before deployment this was a smee.io
     channel, see below). Webhook secret: the value of `GITHUB_WEBHOOK_SECRET`, the same locally and on Render.
   - Repository permissions: **Pull requests: Read and write** (inline review comments),
     **Checks: Read and write** (the Check Run), **Contents: Read and write** (reading files, and committing
     a fix someone accepts, UC-3) (Metadata: Read is automatic). After changing a permission, approve it on
     each installation (Settings → Applications → Configure).
     Organization permissions: **Members: Read** (tells org admins from members when connecting).
   - Subscribe to events: **Pull request** and **Check run** (the Apply all fixes button sends `check_run`
     `requested_action`). GitHub sends `installation` and `installation_repositories` to every App without a
     subscription.
   - Where can it be installed: **Any account**, so organizations and teammates can install it.
   - **Identifying and authorizing users:** Callback URLs `https://codesentinel.scribly.fun/onboarding/github/callback`
     and `http://localhost:3001/onboarding/github/callback` (the dashboard), **Expire user authorization tokens**
     on, **Request user authorization (OAuth) during installation** on.
   - **Post installation:** Setup URL the live callback, **Redirect on update** on.
2. On the App page: note the **App ID** and **Client ID**, **Generate a new client secret**, then
   **Generate a private key** and save the `.pem` as `services/gateway/github-app.pem`.
3. **Install App** from the dashboard (Repositories → **Add repositories**), or from GitHub on
   `code-sentinel-playground` and then **Connect GitHub** in the dashboard.
4. In `services/gateway/.env`: `GITHUB_APP_ID=<id>`, `GITHUB_PRIVATE_KEY_PATH=github-app.pem`,
   `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` and `FIELD_ENCRYPTION_KEY` (see
   [Configuration](#configuration)), and in `apps/dashboard/.env.local` `GITHUB_APP_SLUG` and
   `GITHUB_APP_CLIENT_ID`. Then either of these:
   - **In memory:** `GATEWAY_SEED=dev`, `GATEWAY_DEV_REPOSITORY=sumit-0804/code-sentinel-playground:1390792507`.
   - **With Supabase dev:** `GATEWAY_SEED=none` and `DATABASE_URL=<session pooler URL>`. Then seed the
     repository once: set `SEED_GITHUB_REPOSITORY=sumit-0804/code-sentinel-playground:1390792507` in
     `packages/db/.env` and run `npm run seed -w @code-sentinel/db`. `/healthz` then shows
     `"database":"ok"`.

**Each run:** webhooks go to the deployed gateway. To receive them on a local gateway instead,
create a channel at https://smee.io/new, set it as the App's Webhook URL for the session, run

```bash
npx smee-client --url <smee channel URL> --target http://127.0.0.1:3000/webhooks/github
```

and set the live URL back afterwards (the App has one webhook URL, so the live gateway gets nothing
meanwhile).

Start the orchestrator, the five agents and the gateway (see the root README), then
open a pull request from `demo/risky-change` to `main` in the playground. The gateway log shows
`review_started` with the real files, and the orchestrator job ends with Security findings (SQL
injection, the AWS key, `innerHTML`), Style findings with Prettier fixes, and whatever the Logic,
Performance and Documentation agents find in the changed files. **Redeliver** from the
App's *Advanced → Recent Deliveries* page gives `duplicate_ignored`; a new push gives a new job.

The database setup was run live on 11-Oct (playground PR #4): the gateway logged `stores: postgres`,
found the playground repository and its settings in Supabase dev, and posted "2 critical · 5 info"
with 4 inline comments, the same result as the in-memory runs.

