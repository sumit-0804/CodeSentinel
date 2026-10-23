/** Pages that need a signed-in user. Every page also checks for itself; the proxy only redirects early. */
const APP_PREFIXES = ["/overview", "/pull-requests", "/repositories", "/settings", "/reset-password", "/onboarding", "/step-up"];

/** Pages a signed-in user has no reason to see. */
const GUEST_ONLY = ["/sign-in", "/sign-up", "/forgot-password"];

/** Where someone with an authenticator app enters its code to finish signing in; app pages wait until then. */
export const VERIFY_CODE_PATH = "/verify-code";

const matches = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export const isAppRoute = (pathname: string) => APP_PREFIXES.some((p) => matches(pathname, p));
export const isGuestOnlyRoute = (pathname: string) => GUEST_ONLY.some((p) => matches(pathname, p));
export const isVerifyCodeRoute = (pathname: string) => matches(pathname, VERIFY_CODE_PATH);
