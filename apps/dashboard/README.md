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
| `/overview`, `/repositories` | First-run checklist; installing the GitHub App arrives with A6 |
| `/pull-requests` | Empty state until reviews exist |
| `/settings` | Profile, sign-in methods (link / unlink GitHub and Google), sign out here or everywhere |

`/` redirects to `/overview` until the public landing page (A4c) replaces it.

## How auth works

- **`proxy.ts`** runs on every page request. It refreshes the Supabase session with `getClaims()` (which verifies
  the token's signature) and redirects early: signed-out users on app pages go to `/sign-in?next=…`, signed-in
  users on sign-in / sign-up go to `/overview`.
- **Every app page, layout and Server Action checks again** with `requireUser()` (`lib/auth.ts`), so nothing relies on
  the proxy alone and nothing trusts `getSession()`.
- **There is no browser Supabase client.** Every auth call is a Server Action or a Route Handler, so the browser only
  talks to this origin. (A7 adds a browser client for TOTP enrolment.)
- **`safeNextPath()`** accepts only same-origin paths (`/x`, not `//x`, `/\x`, or URLs with control characters), so
  `next` can't become an open redirect.
- Supabase error codes are mapped to plain sentences (`lib/auth-errors.ts`); raw server messages never reach the page.
- With Cache Components on, anything that reads the session sits behind `<Suspense>`: the sidebar and page frames are
  prerendered, and the parts that name the user stream in.

## Supabase setup (dev project)

Already done: Site URL `http://localhost:3001`, redirect allow-list `http://localhost:3001/**`, GitHub and Google
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
