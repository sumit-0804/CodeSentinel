# Plan — post the review back to the pull request (FR-GH-02..04)

## Status (27-Sep)

| Step | State |
| --- | --- |
| PR 7 AI fixes from the Security Agent | merged (#16) |
| PR 8 publishing from the gateway | code done; the live run waits for the App's Pull requests: Read & write |

Deviation from the plan below: `updateCheckRun` became `completeCheckRun` (the gateway only ever
completes a run), and the review is posted **before** the Check Run is completed, so the summary
can report comments GitHub refused.

## Context

The pipeline now reviews real PRs: webhook → gateway → orchestrator → Security + Style. This was proven on `sumit-0804/code-sentinel-playground` PR #1. But nothing reaches the PR itself. The report stays in the orchestrator, and the gateway starts a job and forgets it.

The design already says what should happen:
- **`seq_uc1_pr_review.mmd`:** the gateway creates a Check Run as soon as the review starts, completes it when the report is ready, then posts inline suggestions.
- **FR-GH-02:** a Check Run with pass / fail / neutral.
- **FR-GH-03:** inline "suggested change" comments for high-confidence findings.
- **FR-GH-04:** never push to the branch; every fix needs a click.
- **AC-01:** "in progress" appears within 5 s.

The schema already has `reviews.github_check_run_id`, `check_conclusion` and `suggestions.github_comment_id`. The effective repository config already carries `confidenceThreshold` and `postInlineComments` (`services/gateway/src/persistence/stores.ts`).

**User decision (27-Sep):** Style's deterministic Prettier/Black fixes are **also** posted inline as one-click suggestions. Style lint findings without a fix appear only in the Check Run.

This is delivered as two PRs. Each gets the full checks (lint, build, typecheck, test), short commits with author = committer, is opened with `gh`, and ends at a checkpoint where the user merges.

---

## PR 7: AI fixes from the Security Agent (author: Tej)

FR-GH-03 wants *suggested changes*. Today only Style produces them; Security's findings have no fix.

- **`services/security-agent/src/llm-pass.ts`:**
  - Add a `suggestedCode` string (`""` when none) to the strict JSON schema and to `LlmAnswerSchema`.
  - Tell the model in the prompt: the full replacement for lines `lineStart..lineEnd`, same indentation, or `""`.
- **Keeping a suggestion:** only if every line in `lineStart..lineEnd` is an added line of that file (use the existing `parsePatch` added-line set), the text isn't blank, and it differs from the original. Then:
  - `originalSnippet` = those lines joined, exactly as in the diff;
  - `suggestion = { kind: "ai_suggested", originalSnippet, suggestedSnippet: maskSecrets(suggestedCode), explanation }`;
  - otherwise the finding keeps no suggestion.
  - A replacement that still contains a masked secret (`****`) is dropped. Otherwise the author would commit a broken line.
- Rule findings stay without suggestions. They only name the problem.
- **Tests** (`agent.test.ts`): a kept suggestion, one dropped for touching context lines, a blank one, one identical to the original, and one with a masked secret.
- **Docs:** the security-agent README ("LLM pass" gets the suggestion rule).

## PR 8: publishing from the gateway (author: Vatsal)

### Contract and client additions
- **`GitHubClient`** (`services/gateway/src/github/github-client.ts`) gains:
  - `createCheckRun(ref, { headSha, name, status })` returning the `id`;
  - `updateCheckRun(ref, id, { status, conclusion, output })`;
  - `createReview(ref, { commitId, event: "COMMENT", body, comments })`.
- **`OctokitGitHubClient`** implements them with the existing per-installation Octokit (`octokit-github-client.ts`):
  - `POST /repos/{o}/{r}/check-runs`
  - `PATCH …/check-runs/{id}`
  - `POST …/pulls/{n}/reviews`
- **`StubGitHubClient`** records every call, so tests and dev mode stay offline.
- **`OrchestratorClient`** (`services/gateway/src/orchestrator/orchestrator-client.ts`) gains `getReviewJob(jobId)`: `GET /internal/v1/review-jobs/{id}`, validated with `ReviewJobSchema`, reusing its `send()`.

### Formatting (pure, `src/github/review-output.ts`, most of the tests)
- **`checkRunConclusion(job, threshold)`:**
  - `failure` if any `critical` finding is at or above the threshold;
  - `neutral` if the job ended `partial`, `failed` or `cancelled`, or the gateway gave up waiting;
  - `success` otherwise.
- **`checkRunOutput(job, threshold)`** returns `{ title, summary, annotations }`. The summary is markdown with:
  - counts by severity;
  - coverage (`Reviewed 2 of 2 files · 16 of 16 changed lines`);
  - skipped files with reasons;
  - one line per agent run: ✓, "no result" (timeout or failure), or "LLM analysis deferred" (`llm_quota_exhausted`);
  - how many findings fell below the threshold.

  Annotations cover findings at or above the threshold:
  - `failure` for critical, `warning` for warning, `notice` for info;
  - title and CWE included; message capped at GitHub's size limits.
- **`reviewComments(job, threshold)`:** findings at or above the threshold with a suggestion; per the user's decision, that includes Style's deterministic fixes.
  - Each comment has `path`, `line` = `lineEnd`, `start_line` = `lineStart` (when the range spans lines) and `side: RIGHT`.
  - The body gives severity, agent, title, description and CWE, then a ```` ```suggestion ```` block holding `suggestedSnippet`, plus a note saying whether it's deterministic or AI-suggested.
  - Security findings above the threshold **without** a suggestion are also posted inline, as plain comments (FR-GH-03 covers Security). Style findings without a fix are not.
- **Limits:** annotations are sent 50 per `updateCheckRun` call (GitHub's cap), and at most 50 inline comments per review; any overflow is summarised in the Check Run.

### Flow (`src/github/review-publisher.ts`, `ReviewPublisher`)
- **In `webhooks/github-webhook.ts`:** after `createReviewJob` answers **created**, the webhook still returns 202 straight away. Then it calls `publisher.follow({ ref, headSha, jobId, threshold, postInlineComments })` without awaiting it. Duplicates (`created: false`) never reach this, so a redelivery makes no second Check Run.
- **`follow`:**
  1. `createCheckRun` "Code-Sentinel", `in_progress`, on `headSha` (AC-01).
  2. Poll `getReviewJob` every 2 s until a terminal status, with a 5-minute cap (`REVIEW_POLL_TIMEOUT_MS`).
  3. `updateCheckRun`: `completed` with the conclusion and output.
  4. If `postInlineComments` and there are comments, `createReview` with `event: "COMMENT"`, so it never approves or blocks.
     - A 422 (a comment line GitHub won't accept) retries each comment as its own review and skips the ones that still fail.
     - The number posted and skipped is logged and added to the Check Run summary.
- **Failures never crash the gateway.** A GitHub or orchestrator error after the 202 is logged with the request id, and the Check Run is completed `neutral` with the reason, if one was created. If creating the Check Run fails, it logs and keeps polling, so inline comments can still be posted.
- A new push starts a new job and Check Run on the new SHA. GitHub marks old comments "outdated" itself.
- **Wiring:** `app.ts` / `server.ts` build the publisher with the existing logger, `github` and `orchestrator`.

### Out of scope (docs say so)
- Storing check-run and comment ids in PostgreSQL (the store isn't built yet).
- Accept/reject tracking of suggestions (UC-3).
- Cancelling a superseded job on a new push (the orchestrator cancel exists; wiring it is a later step).

### Tests
- `review-output.test.ts`:
  - each conclusion rule;
  - summary lines, including no result, deferred, skipped and coverage;
  - annotation levels and batching;
  - suggestion bodies for Style (deterministic) and Security (AI), a plain Security comment, the threshold filter, multi-line `start_line`, and the 50-comment cap.
- `review-publisher.test.ts`, with a fake clock, a stub GitHub and a fake orchestrator:
  - the Check Run is created, polled to completion, updated and the review posted;
  - a timeout gives `neutral`;
  - the 422 fallback;
  - `postInlineComments: false`;
  - a failing Check Run creation still posts comments.
- `github-webhook.test.ts`: `follow` is called for new jobs only (not for duplicates or ignored events).
- `octokit-github-client.test.ts`: the three new endpoints against a stubbed `fetch` (paths, bodies, 50-annotation batches).
- `orchestrator-client.test.ts`: `getReviewJob`.

---

## Docs
- **Gateway README:**
  - "Publishing to GitHub" section: flow, conclusion rules, what gets posted, and the limits;
  - `REVIEW_POLL_TIMEOUT_MS` in the config table;
  - the App permission change in the setup steps;
  - "Not started yet" updated.
- **`seq_uc1_pr_review.mmd`:** a note that the gateway polls the job. Re-render the PNG with `render_mermaid.py`.
- **New `plans/github-posting.md`** (this plan) with a status table. Add a line to `plans/llm-agents.md`.
- **Next status report:** note FR-GH-02/03 done.

## Your part (before the live run)
In the App settings (`code-sentinel-dev-sumit`) → Permissions:
1. Set **Pull requests** to **Read & write** (Checks is already write).
2. Accept the new permission on the playground installation. GitHub requires the owner to approve it.

## Verification
1. Every PR: `npm run lint && npm run build && npm run typecheck && npm run test` at the root; CI green on the PR.
2. **PR 7, live:** one Security review with the dev keys on the playground files (a few LLM calls, with your OK). Expect at least one `ai_suggested` fix that only touches added lines.
3. **PR 8, live** (after the permission change): start smee and the four services, then push a commit to playground PR #1.
   - Within 5 s, a "Code-Sentinel" Check Run shows **in progress**.
   - It completes **failure** (critical findings), with a summary (counts, coverage, agent lines) and annotations on `app/payments.py:3` and `:14` and `web/cart.js`.
   - One review with inline comments: the AWS key and SQL injection (with an AI fix if the model gave one), and the Prettier fixes as one-click suggestions.
   - Redelivering the webhook: no second Check Run and no second review.
   - Check with `gh api` (check-runs and pulls/1/reviews and comments), and have you look at the PR page.
