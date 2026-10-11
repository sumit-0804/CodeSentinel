import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  /** How the account was first created: email, github or google. */
  provider: string;
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Verified claims of the signed-in user, read once per request. Null when signed out. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // Token checks read the clock, so this must run at request time, never in a prerender.
  await connection();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;

  const { claims } = data;
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const app = (claims.app_metadata ?? {}) as Record<string, unknown>;
  return {
    id: claims.sub,
    email: text(claims.email),
    name: text(meta.full_name) ?? text(meta.name) ?? text(meta.user_name),
    avatarUrl: text(meta.avatar_url),
    provider: text(app.provider) ?? "email",
  };
});

/** For every app page, layout and Server Action: never rely on the proxy alone. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

export function initials(user: Pick<CurrentUser, "name" | "email">): string {
  const source = user.name ?? user.email ?? "?";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (user.name ? (parts[1]?.[0] ?? "") : "")).toUpperCase();
}
