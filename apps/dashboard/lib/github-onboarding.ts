import { randomBytes, timingSafeEqual } from "node:crypto";

/** Holds the random `state` between leaving for GitHub and coming back, so a callback can't be forged. */
export const STATE_COOKIE = "cs_gh_state";
export const STATE_MAX_AGE_SECONDS = 600;
export const CALLBACK_PATH = "/onboarding/github/callback";

export const newState = () => randomBytes(24).toString("base64url");

/** Constant-time comparison of the `state` GitHub returned with the one in our cookie. */
export function stateMatches(returned: string | null | undefined, expected: string | undefined): boolean {
  if (!returned || !expected) return false;
  const a = Buffer.from(returned);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const installUrl = (slug: string, state: string) =>
  `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`;

/** Authorize without installing: links GitHub and picks up organizations the App is already on. */
export function connectUrl(clientId: string, state: string, siteUrl: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", `${siteUrl}${CALLBACK_PATH}`);
  return url.toString();
}

/** The page that asks for an authenticator code, then continues to `next` (a route on this site). */
export const stepUpUrl = (siteUrl: string, next: string) => `${siteUrl}/step-up?next=${encodeURIComponent(next)}`;

/** Where the callback sends the user, by what happened; the page explains each case in plain words. */
export type OnboardingOutcome =
  | "connected"
  | "synced"
  | "cancelled"
  | "confirm"
  | "unconfigured"
  | "code_invalid"
  | "account_taken"
  | "not_linked"
  | "github_unavailable"
  | "step_up"
  | "failed";

/** Maps a gateway error code from `/v1/github/link` or `/v1/installations/sync` to an outcome. */
export function outcomeForGatewayError(code: string | undefined): OnboardingOutcome {
  switch (code) {
    case "github_code_invalid":
      return "code_invalid";
    case "github_account_taken":
      return "account_taken";
    case "github_not_linked":
      return "not_linked";
    case "github_link_unconfigured":
      return "unconfigured";
    case "github_unavailable":
      return "github_unavailable";
    case "mfa_required":
      return "step_up";
    default:
      return "failed";
  }
}
