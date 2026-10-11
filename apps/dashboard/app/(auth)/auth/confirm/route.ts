import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-next-path";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const EMAIL_LINK_TYPES: readonly EmailOtpType[] = ["email", "signup", "recovery", "invite", "email_change"];
const isEmailLinkType = (value: string | null): value is EmailOtpType =>
  EMAIL_LINK_TYPES.includes(value as EmailOtpType);

// Our templates send a token hash, which works in any browser. Supabase's default `{{ .ConfirmationURL }}`
// verifies on Supabase and lands here with a PKCE code instead, which works in the browser that asked for it.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const code = params.get("code");
  const next = safeNextPath(params.get("next"));
  const site = env().NEXT_PUBLIC_SITE_URL;

  const supabase = await createSupabaseServerClient();
  let error: unknown = null;
  if (tokenHash && isEmailLinkType(type)) {
    ({ error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }));
  } else if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else {
    return NextResponse.redirect(`${site}/auth/error?reason=link`);
  }
  // A code only arrives after Supabase confirmed the email, so a failed exchange still means "confirmed, sign in".
  if (error) return NextResponse.redirect(`${site}/auth/error?reason=${code && !tokenHash ? "confirmed" : "link"}`);
  return NextResponse.redirect(`${site}${next}`);
}
