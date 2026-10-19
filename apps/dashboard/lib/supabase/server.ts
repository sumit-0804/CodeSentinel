import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { env } from "@/lib/env";

/** A fresh client per request; it reads and writes the auth cookies through Next's cookie store. */
export async function createSupabaseServerClient() {
  const [cookieStore, incoming] = await Promise.all([cookies(), headers()]);
  const userAgent = incoming.get("user-agent");
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } = env();

  return createServerClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    // Supabase records the session's browser from this; without it every device reads "node".
    ...(userAgent ? { global: { headers: { "User-Agent": userAgent } } } : {}),
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components can't set cookies; the proxy already refreshed the session for this request.
        }
      },
    },
  });
}
