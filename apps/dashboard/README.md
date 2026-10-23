# @code-sentinel/dashboard

The Code Sentinel web app: Next.js 16 (App Router, Cache Components), Tailwind v4, shadcn/ui on Radix, a few
Aceternity UI components, and Supabase Auth. It runs on `http://localhost:3001` (the gateway owns 3000).

The look follows the approved mockup in `plans/dashboard-mockup.html`: one dark neon theme, Unbounded / Manrope /
Martian Mono, cyan `#3df0ff` as the only accent, glow only on the logo, the primary button, the current page, focus
and the agent lanes.

## Run it

```bash
cp apps/dashboard/.env.example apps/dashboard/.env.local
```

Fill in the dev Supabase project's URL and **publishable** key (Project Settings → API Keys), then:

```bash
npm run dev -w @code-sentinel/dashboard
```

| Variable | What it is |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The publishable key (safe in the browser; never the secret key) |
| `NEXT_PUBLIC_SITE_URL` | This app's origin. Every auth redirect is built from it, never from the `Host` header |
| `GATEWAY_URL` | The API gateway (`http://localhost:3000` locally). Server-only, never `NEXT_PUBLIC_`. Unset → pages say the API isn't configured |
| `GITHUB_APP_SLUG` | The GitHub App's URL name (`code-sentinel-mvp`), for the install link. Server-only |
| `GITHUB_APP_CLIENT_ID` | The App's client ID, for the "connect" link. Server-only. Both unset → the buttons explain GitHub isn't set up |

Env is validated with zod the first time it's read (`lib/env.ts`), so `next build` works without it, as in CI.

## Routes

| Route | What it does |
| --- | --- |
| `/sign-in` | Email + password, or Continue with GitHub / Google. Keeps a safe `?next=` |
| `/sign-up` | Email + password (8+ characters, a letter and a number). Same answer whether or not the email exists |
| `/forgot-password` | Sends a reset link; same answer for every email |
| `/reset-password` | Needs the recovery session from the email link, then sets a new password |
| `/auth/callback` | OAuth sign-in and identity linking: exchanges the PKCE code |
| `/auth/confirm` | Email links (`token_hash` + `type`): sign-up, recovery, invite, email change. Works in any browser |
| `/auth/error` | Names what failed and offers one next action |
| `/overview` | First-run checklist until the first review (step 2 is done once the organization has a repository); after that a headline (what's blocked or being reviewed), a notice when an agent isn't answering or runs without its AI checks (`/v1/agents/health`; an agent that's only asleep on free hosting gets no notice, just an "Asleep" tag on the repository's Agents tab), counts, **Needs your attention** (blocked, running, partial or failed) and the 5 most recent reviews, refreshing while one runs |
| `/repositories` | The organization's repositories with a search; the checklist while there are none. Shows what happened on the way back from GitHub (`?github=…`). Each name opens its repository page |
| `/repositories/[owner]/[name]` | One repository (`?tab=agents\|advanced`): reviews on/off with Undo; **Agents**: a notice when an agent the repository runs isn't healthy, each agent's health by its name, follow the organization defaults, or each agent Off / Comment / Block merge, and the confidence threshold (inherit or override); **Advanced**: the repository's own branches to review (its default branch until any are added; "Use organization defaults" doesn't cover them), picked from the repository's GitHub branches (`/v1/repositories/{id}/branches`) or typed as a pattern, and Manage on GitHub; **Pull requests**: the repository's **open** pull requests from GitHub (`/v1/repositories/{id}/pulls`), each with its newest verdict and **Review now** / **Re-run**, or "Base branch not reviewed". The threshold shows how many findings of the last review it would post, live as the slider moves |
| `/onboarding/github/install` | Sets a random `state` cookie and sends you to install the App on GitHub |
| `/onboarding/github/connect` | Same, through GitHub's authorize page: links GitHub and joins organizations the App is already on |
| `/onboarding/github/callback` | GitHub's Callback and Setup URL. A `code` with a matching `state` is sent to `POST /v1/github/link`; without our `state` the code is never used and you confirm instead; an installation updated on GitHub (no code) triggers a sync |
| `/pull-requests` | Each pull request's newest review (`GET /v1/reviews?latest=true`): verdict lanes, verdict, severity counts, filters by verdict. Empty state until reviews exist |
| `/pull-requests/[reviewId]` | One review: verdict and why, commit, threshold, View on GitHub, the gauge, **Apply all fixes (N)** when the review has open fixes (one commit for Style and AI fixes, after a dialog that says how many are AI-suggested, then the TOTP step-up), and **Re-run review**; findings by file with severity filters, each with "Also flagged by" chips when other agents reported the same issue, expanding to its description, the other agents' notes and the fix (before/after) with **Commit fix** / **Dismiss**, or what was decided; findings below the threshold dimmed as not posted; agent runs. While the review runs, the page refreshes every 3 s |
| `/settings` | Profile, sign-in methods (link / unlink GitHub and Google), sign out here or everywhere |
| `/settings?section=defaults` | **Review defaults**: the organization's agent modes, used by repositories that follow them, and its confidence threshold. Branches are set per repository |
| `/settings?section=security` | **Security**: add authenticator apps (QR code or key, then a code to confirm), a second one as the backup, and remove them after a code; **Signed-in devices** (`/v1/me/sessions`): browser and system read from the user agent, IP, last active, "This device", and **Sign out** for any other one after a code |
| `/settings?section=audit` | **Audit log** for organization admins (`/v1/organizations/{id}/audit-events`): when, who, what (in words, from the action and its details) and from where, newest first, with **Older events** |
| `/step-up` | Asks for an authenticator code, then continues to `?next=` (a safe same-origin path). Install and Connect send you here when you have an authenticator and your code is too old |
`/` redirects to `/overview`.

**Deciding on a fix (UC-3).** An expanded finding with a posted fix shows `FixActions` (`components/reviews/fix-actions.tsx`):
- **Commit fix:** calls the `commitFix` server action through `useStepUp`, so someone with an authenticator app
  is asked for a code first. The gateway commits the fix onto the pull request branch, and the pull request is reviewed again.
- **Dismiss:** a reason (not a real problem, doesn't apply here, I'll fix it myself, something else) and an
  optional comment. No code changes.
- **Once decided:** the finding shows "Committed in {sha}", "Dismissed: …" or "Replaced by a newer review".
- **Errors:** the gateway's refusals (head moved, fork, lines changed, missing App permission) become plain
  messages (`lib/fix-messages.ts`).

**Re-running a review.** `RerunButton` (`components/reviews/rerun-button.tsx`) calls the `rerunReview` server action
(`app/(app)/pull-requests/actions.ts`), which sends `POST /v1/reviews` with `{ repositoryId, pullRequestNumber }`.
- Any member of the organization can re-run; it changes no settings, so no authenticator code is asked.
- On success it opens the new review. The gateway's refusals become plain messages: already running, nothing to
  review, base branch not reviewed, reviews off, GitHub or the review service down.

**Verdicts.** A review's verdict (`lib/review-view.ts`) follows the GitHub Check Run conclusion the gateway stores:
`fail` is **Blocked**. Reviews from before that was stored fall back to "any critical finding blocks". Running
reviews show as **Reviewing**, and a review that didn't finish as **Partial** or **Failed**.

**Saving configuration.** The repository page and Review defaults read and write the gateway's
`/v1/repositories/{id}/config` and `/v1/organizations/{id}/review-defaults` through server actions
(`app/(app)/repositories/actions.ts`). Edits stay in a draft until **Save changes** in the sticky bar; only what
changed is sent (`lib/config-draft.ts`), and the browser asks before leaving with unsaved changes. Only
organization admins can save: members see the settings read-only, and the gateway checks the role again. Turning
every agent off is caught before Save.

**Authenticator codes (A7).** An authenticator app is optional. Without one, nothing asks for a code. Once someone
adds one in Settings → Security, only security changes need it, never signing in or reading. Each needs a code from
the last 10 minutes (the gateway's `MFA_STEP_UP_MINUTES`): saving repository settings and review defaults,
connecting repositories, fixes, and signing out a device.
- **Saves** go through `useStepUp()` (`components/auth/step-up.tsx`). When the gateway answers `mfa_required`,
  one dialog asks for the code, then saves again.
- **Install and Connect** check first (`needsStepUp()` in `lib/mfa.ts`: has an authenticator and no fresh code,
  the same rule as the gateway, shared from `@code-sentinel/contracts`) and send you to `/step-up` when needed.
  If GitHub took too long and the code ran out, the callback shows "Your authenticator code ran out" with a way
  back.
- Codes are checked with `mfa.challengeAndVerify` in Server Actions (`app/(app)/settings/security-actions.ts`).
  The session's new token is `aal2` with a fresh `totp` time, and `gatewayFetch` sends it on.

**Locked out?** Supabase has no recovery codes turned on here, so the backup is a second authenticator. If both are
lost, an admin confirms who the person is and runs `scripts/mfa-reset.mjs <user-id>` from their own shell with
`SUPABASE_URL` and `SUPABASE_SECRET_KEY`. It lists the user's authenticators, and removes them only with `--yes`.
The secret key is never put in a file or deployed.

## How auth works

- **`proxy.ts`** runs on every page request. It refreshes the Supabase session with `getClaims()` (which verifies
  the token's signature) and redirects early: signed-out users on app pages go to `/sign-in?next=…`, signed-in
  users on sign-in / sign-up go to `/overview`.
- **Every app page, layout and Server Action checks again** with `requireUser()` (`lib/auth.ts`), so nothing relies on
  the proxy alone and nothing trusts `getSession()`.
- **There is no browser Supabase client.** Every auth call is a Server Action or a Route Handler, including
  authenticator enrolment and codes, so the browser only talks to this origin.
- **`safeNextPath()`** accepts only same-origin paths (`/x`, not `//x`, `/\x`, or URLs with control characters), so
  `next` can't become an open redirect.
- Supabase error codes are mapped to plain sentences (`lib/auth-errors.ts`); raw server messages never reach the page.
- **Calling the gateway:** `gatewayFetch(path, schema)` (`lib/gateway.ts`, server-only) verifies the
  user first, then sends their Supabase access token as `Authorization: Bearer`, with a 5 s timeout,
  and checks the JSON against a schema from `@code-sentinel/contracts`. The browser never talks to the
  gateway (backend-for-frontend), so there is no CORS and no token in client code. It returns
  `{ ok: true, data }` or `{ ok: false, reason }` (`unconfigured`, `unreachable`, `unauthorized`,
  `error`), so a page names what failed, plus the gateway's error `code` when it sent one. It also
  forwards the browser's IP (`X-Forwarded-For`, from the incoming request) and `User-Agent`, so the
  gateway's rate limits and audit log see the person, not this server.
- **Organization in use:** the sidebar switcher lists the memberships from `/v1/me`. Choosing one sets
  the httpOnly `cs_org` cookie through a Server Action that first checks the membership. Pages read it
  with `getAccount()` (`lib/organization.ts`, once per request), fall back to the first membership if it
  no longer matches, and send it as `X-Organization-Id`. The gateway checks it again.
- With Cache Components on, anything that reads the session sits behind `<Suspense>`: the sidebar and page frames are
  prerendered, and the parts that name the user stream in.

## Supabase setup (dev project)

Already done: Site URL (the live site since deployment, see below), redirect allow-list `http://localhost:3001/**`, GitHub and Google
providers, Resend SMTP, TOTP, 600 s access tokens. Three more steps for this app:

1. **Email templates** (Authentication → Emails → Templates). Paste each file from [`emails/`](emails/) into the
   template's **Source** and set its subject:

   | Template | File | Subject | Link goes to |
   | --- | --- | --- | --- |
   | Confirm signup | `confirm-signup.html` | Confirm your Code Sentinel email | `/auth/confirm?type=email` |
   | Reset password | `reset-password.html` | Reset your Code Sentinel password | `…type=recovery&next=/reset-password` |
   | Invite user | `invite.html` | You're invited to Code Sentinel | `…type=invite&next=/reset-password` (choose a password) |
   | Change email address | `change-email.html` | Confirm your new email | `…type=email_change&next=/settings` |

   They're table layouts with inline styles and no images or web fonts, so Gmail and Outlook render them as
   designed. Every link carries `token_hash`, so it works in any browser.
2. **Allow manual linking** (Authentication → Sign In / Providers), which "Link GitHub / Google" needs.
3. **Password policy** (Authentication → Sign In / Providers → Email): minimum length 8, letters and digits required,
   matching the form.

## Deploy (Vercel)

Live at `https://codesentinel.scribly.fun`, on the same Supabase project as local development.

1. **New Project** from `sumit-0804/CodeSentinel`, **Root Directory** `apps/dashboard`. [`vercel.json`](vercel.json)
   installs at the repo root and builds the workspace packages first (they export `dist`), through
   `turbo run build --filter=@code-sentinel/dashboard`.
2. **Environment variables** (Production):

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | as in `.env.local` |
   | `NEXT_PUBLIC_SITE_URL` | `https://codesentinel.scribly.fun` |
   | `GATEWAY_URL` | `https://api.codesentinel.scribly.fun` |
   | `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID` | as in `.env.local` |

   `NEXT_PUBLIC_*` values are baked in at build time (the CSP too), so redeploy after changing them.
3. **Domains:** add `codesentinel.scribly.fun`, then the CNAME Vercel shows in Hostinger's DNS zone.
4. **Supabase** (Authentication → URL Configuration): Site URL `https://codesentinel.scribly.fun`, and add
   `https://codesentinel.scribly.fun/**` to the redirect allow-list next to `http://localhost:3001/**`. The email
   templates link to the Site URL, so emails sent while developing locally also open the live site.
5. **GitHub App** (Settings → Developer settings → the App): add the callback URL
   `https://codesentinel.scribly.fun/onboarding/github/callback`, and keep the localhost one.

## Security headers

`next.config.ts` sends, on every route (`lib/csp.ts`):
- a Content Security Policy: `'self'` everywhere, avatar hosts for images, `frame-ancestors 'none'`, and `form-action`
  limited to this origin, Supabase, GitHub and Google (the OAuth redirect chain)
- `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY`, and HSTS in production

Scripts allow `'unsafe-inline'` because Next's hydration scripts are inline. A nonce-based CSP would make every page
fully dynamic and lose the prerendered shells, so it's left for later. Brute-force limits are Supabase Auth's own.

## Motion and Aceternity components

`components/ui/` holds four Aceternity UI components, adapted to our tokens:
- `background-beams` behind the sign-in hero
- `encrypted-text` for the "Blocked." verdict
- `text-generate-effect` for the onboarding headline
- `loader` for pending buttons

Rules: one noticeable effect per screen, `motion` is the only animation library, and everything respects
`prefers-reduced-motion` (`MotionConfig reducedMotion="user"` plus a CSS fallback in `globals.css`). Avoid
three.js, particles and tilt cards.

Avatars: GitHub and Google users get their photo. Email users get a [DiceBear](https://www.dicebear.com/)
"Bottts Neutral" robot on one of the brand colours, seeded by their user id (`lib/robot-avatar.ts`). It's drawn
on the server as an inline SVG, so no third party is called and the id never appears in the image. Both sit in a
violet→cyan ring. Bottts artwork by Pablo Stanley is free for commercial use, and DiceBear's code is MIT.

## Checks

```bash
npm run lint -w @code-sentinel/dashboard
npm run typecheck -w @code-sentinel/dashboard
npm run test -w @code-sentinel/dashboard
npm run build -w @code-sentinel/dashboard
```

Unit tests cover `lib/` (redirect guard, env, error mapping, form schemas, CSP, robot avatar). Screens are checked
by hand against the mockup.
