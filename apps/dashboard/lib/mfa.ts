import "server-only";
import { isStepUpFresh } from "@code-sentinel/contracts";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Authenticator = { id: string; name: string; createdAt: string };

/** The signed-in user's verified authenticator apps (TOTP factors), oldest first. */
export async function listAuthenticators(): Promise<Authenticator[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  return (data?.totp ?? [])
    .filter((factor) => factor.status === "verified")
    .map((factor) => ({ id: factor.id, name: factor.friendly_name ?? "Authenticator app", createdAt: factor.created_at }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** True when a security change must ask for a code first: the user has an authenticator app and no fresh code. */
export async function needsStepUp(): Promise<boolean> {
  const [authenticators, fresh] = await Promise.all([listAuthenticators(), hasFreshStepUp()]);
  return authenticators.length > 0 && !fresh;
}

/** True when this session entered an authenticator code recently enough for the gateway's step-up (A7). */
export async function hasFreshStepUp(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return false;
  // `amr` may also be plain method names (RFC 8176); only entries with a timestamp can prove freshness.
  const amr = (data.claims.amr ?? []).flatMap((entry) => (typeof entry === "string" ? [] : [entry]));
  return isStepUpFresh({ aal: data.claims.aal, amr }, Date.now());
}
