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
  mfa_verification_failed: "That code didn't match. Codes change every 30 seconds: enter the one showing now.",
  mfa_challenge_expired: "That took too long. Enter the code showing now.",
  mfa_factor_name_conflict: "You already have an authenticator with that name. Choose another.",
  mfa_factor_not_found: "That authenticator wasn't found. Reload the page and try again.",
  too_many_enrolled_mfa_factors: "You have the most authenticators allowed. Remove one first.",
  insufficient_aal: "Enter a code from your authenticator app first.",
  mfa_totp_enroll_not_enabled: "Authenticator apps are turned off on the server.",
  mfa_totp_verify_not_enabled: "Authenticator apps are turned off on the server.",
};

const FALLBACK = "Something went wrong on our side. Try again in a moment.";

export function authErrorMessage(error: AuthErrorLike): string {
  if (!error) return FALLBACK;
  if (error.code && MESSAGES[error.code]) return MESSAGES[error.code];
  if (error.status === 429) return MESSAGES.over_request_rate_limit;
  return FALLBACK;
}
