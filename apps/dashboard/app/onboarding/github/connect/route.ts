import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { env, githubApp } from "@/lib/env";
import { connectUrl, newState, STATE_COOKIE, STATE_MAX_AGE_SECONDS } from "@/lib/github-onboarding";

// Authorizes the App without installing it: links GitHub and picks up organizations it is already on.
export async function GET() {
  await requireUser();
  const site = env().NEXT_PUBLIC_SITE_URL;
  const app = githubApp();
  if (!app) return NextResponse.redirect(`${site}/repositories?github=unconfigured`);

  const state = newState();
  const response = NextResponse.redirect(connectUrl(app.clientId, state, site));
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: site.startsWith("https://"),
    path: "/onboarding/github",
    maxAge: STATE_MAX_AGE_SECONDS,
  });
  return response;
}
