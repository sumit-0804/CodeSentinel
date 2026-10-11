"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authErrorMessage } from "@/lib/auth-errors";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const LINKABLE = ["github", "google"] as const;
type Linkable = (typeof LINKABLE)[number];
const isLinkable = (value: unknown): value is Linkable => LINKABLE.includes(value as Linkable);

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

/** "local" ends this browser's session; "global" ends every session for the account. */
export async function signOut(scope: "local" | "global" = "local"): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: scope === "global" ? "global" : "local" });
  redirect("/sign-in");
}

export async function linkIdentity(provider: string): Promise<ActionResult> {
  await requireUser();
  if (!isLinkable(provider)) return { ok: false, message: "Choose GitHub or Google." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: { redirectTo: `${env().NEXT_PUBLIC_SITE_URL}/auth/callback?next=/settings` },
  });
  if (error || !data.url) return { ok: false, message: authErrorMessage(error) };
  redirect(data.url);
}

export async function unlinkIdentity(provider: string): Promise<ActionResult> {
  await requireUser();
  if (!isLinkable(provider)) return { ok: false, message: "Choose GitHub or Google." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error || !data) return { ok: false, message: authErrorMessage(error) };

  const identity = data.identities.find((item) => item.provider === provider);
  if (!identity) return { ok: false, message: "That sign-in method isn't linked." };
  if (data.identities.length < 2) {
    return { ok: false, message: "Link another sign-in method before removing this one." };
  }

  const { error: unlinkError } = await supabase.auth.unlinkIdentity(identity);
  if (unlinkError) return { ok: false, message: authErrorMessage(unlinkError) };

  revalidatePath("/settings");
  return { ok: true, message: `${provider === "github" ? "GitHub" : "Google"} unlinked` };
}
