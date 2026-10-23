import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { env, githubApp } from "@/lib/env";
import { installUrl, newState, STATE_COOKIE, STATE_MAX_AGE_SECONDS, stepUpUrl } from "@/lib/github-onboarding";
import { needsStepUp } from "@/lib/mfa";

// Leaves for GitHub's install page with a fresh `state`; the callback only trusts a code that brings it back.
export async function GET() {
  await requireUser();
  const site = env().NEXT_PUBLIC_SITE_URL;
  const app = githubApp();
  if (!app) return NextResponse.redirect(`${site}/repositories?github=unconfigured`);
  // With an authenticator app, the gateway links repositories only after a fresh code, so ask for it before leaving.
  if (await needsStepUp()) return NextResponse.redirect(stepUpUrl(site, "/onboarding/github/install"));

  const state = newState();
  const response = NextResponse.redirect(installUrl(app.slug, state));
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: site.startsWith("https://"),
    path: "/onboarding/github",
    maxAge: STATE_MAX_AGE_SECONDS,
  });
  return response;
}
