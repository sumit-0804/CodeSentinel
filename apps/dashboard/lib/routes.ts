/** Pages that need a signed-in user. Every page also checks for itself; the proxy only redirects early. */
const APP_PREFIXES = ["/overview", "/pull-requests", "/repositories", "/settings", "/reset-password"];

/** Pages a signed-in user has no reason to see. */
const GUEST_ONLY = ["/sign-in", "/sign-up", "/forgot-password"];

const matches = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export const isAppRoute = (pathname: string) => APP_PREFIXES.some((p) => matches(pathname, p));
export const isGuestOnlyRoute = (pathname: string) => GUEST_ONLY.some((p) => matches(pathname, p));
