/** The headers a request carries; `Headers` and Next's request headers both fit. */
type HeaderSource = { get(name: string): string | null };

/** The browser's IP, as the host's proxy (Vercel) reports it, and its User-Agent. */
export function browserOrigin(incoming: HeaderSource): { ip?: string; userAgent?: string } {
  const ip = incoming.get("x-forwarded-for")?.split(",")[0]?.trim() || incoming.get("x-real-ip") || undefined;
  const userAgent = incoming.get("user-agent") || undefined;
  return { ...(ip ? { ip } : {}), ...(userAgent ? { userAgent } : {}) };
}

/**
 * Headers for this server's calls to Supabase Auth: the browser's User-Agent, which Supabase records as the
 * session's device. Hosted Supabase ignores a forwarded IP, so the gateway records the real one (`session_activity`).
 */
export function supabaseOriginHeaders(incoming: HeaderSource): Record<string, string> {
  const { userAgent } = browserOrigin(incoming);
  return userAgent ? { "User-Agent": userAgent } : {};
}
