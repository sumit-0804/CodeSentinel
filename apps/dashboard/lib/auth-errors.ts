/** The parts of a Supabase AuthError we map to plain sentences. */
export type AuthErrorLike = { code?: string; status?: number; message?: string } | null | undefined;

const MESSAGES: Record<string, string> = {
  invalid_credentials: "That email and password don't match an account. Check both, or reset your password.",
  email_not_confirmed: "Confirm your email first. Open the link we sent you, then sign in.",
  user_already_exists: "An account already uses this email. Sign in instead.",
  weak_password: "Choose a stronger password: at least 8 characters, with a letter and a number.",
  same_password: "Choose a password you haven't used for this account before.",
  over_request_rate_limit: "Too many attempts. Wait a minute, then try again.",
  over_email_send_rate_limit: "Too many emails sent. Wait a few minutes, then try again.",
  identity_already_exists: "That account is already linked to another Code Sentinel user.",
  single_identity_not_deletable: "Link another sign-in method before removing this one.",
  manual_linking_disabled: "Linking accounts is turned off on the server. Ask an admin to enable manual linking.",
  provider_disabled: "This sign-in method is turned off right now.",
  session_not_found: "Your session has ended. Sign in again.",
  otp_expired: "This link has expired or was already used. Ask for a new one.",
};

const FALLBACK = "Something went wrong on our side. Try again in a moment.";

export function authErrorMessage(error: AuthErrorLike): string {
  if (!error) return FALLBACK;
  if (error.code && MESSAGES[error.code]) return MESSAGES[error.code];
  if (error.status === 429) return MESSAGES.over_request_rate_limit;
  return FALLBACK;
}
