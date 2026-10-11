import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-next-path";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// OAuth sign-in and identity linking land here with a PKCE code.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const next = safeNextPath(params.get("next"));
  const site = env().NEXT_PUBLIC_SITE_URL;

  if (!code) {
    const reason = params.get("error_code") === "identity_already_exists" ? "identity_taken" : "oauth";
    return NextResponse.redirect(`${site}/auth/error?reason=${reason}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${site}/auth/error?reason=oauth`);
  return NextResponse.redirect(`${site}${next}`);
}
