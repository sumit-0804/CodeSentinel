import { GithubLinkResultSchema } from "@code-sentinel/contracts";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { gatewayFetch } from "@/lib/gateway";
import { outcomeForGatewayError, stateMatches, STATE_COOKIE, type OnboardingOutcome } from "@/lib/github-onboarding";

/**
 * GitHub's Callback URL and Setup URL. With a code and a matching `state`, the gateway links GitHub and
 * syncs; a code without our `state` is never used (it could be someone else's), so the user confirms
 * by starting the connect flow. An installation updated on GitHub comes back without a code: re-sync.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const site = env().NEXT_PUBLIC_SITE_URL;
  const expectedState = request.cookies.get(STATE_COOKIE)?.value;

  const finish = (outcome: OnboardingOutcome, repositories?: number) => {
    const target = new URL("/repositories", site);
    target.searchParams.set("github", outcome);
    if (repositories !== undefined) target.searchParams.set("repos", String(repositories));
    const response = NextResponse.redirect(target);
    response.cookies.set(STATE_COOKIE, "", { path: "/onboarding/github", maxAge: 0 });
    return response;
  };

  if (params.get("error")) return finish("cancelled");

  const code = params.get("code");
  if (!code) {
    const synced = await gatewayFetch("/v1/installations/sync", GithubLinkResultSchema, { method: "POST" });
    if (!synced.ok) return finish(synced.reason === "unconfigured" ? "unconfigured" : outcomeForGatewayError(synced.code));
    return finish("synced", synced.data.installations.reduce((sum, i) => sum + i.repositoryCount, 0));
  }

  if (!stateMatches(params.get("state"), expectedState)) return finish("confirm");

  const linked = await gatewayFetch("/v1/github/link", GithubLinkResultSchema, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!linked.ok) return finish(linked.reason === "unconfigured" ? "unconfigured" : outcomeForGatewayError(linked.code));
  return finish("connected", linked.data.installations.reduce((sum, i) => sum + i.repositoryCount, 0));
}
