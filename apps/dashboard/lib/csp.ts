const AVATAR_HOSTS = ["https://avatars.githubusercontent.com", "https://*.googleusercontent.com"];

/**
 * Static CSP for every route. Next's hydration scripts are inline, so scripts allow 'unsafe-inline';
 * a nonce would make every page dynamic (see the README).
 */
export function contentSecurityPolicy({ supabaseUrl, dev }: { supabaseUrl?: string; dev: boolean }): string {
  const supabase = supabaseUrl ? new URL(supabaseUrl).origin : "";
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...AVATAR_HOSTS],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...(dev ? ["ws:"] : [])],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    // Server Actions answer OAuth starts with a redirect to Supabase, then GitHub or Google.
    "form-action": ["'self'", supabase, "https://github.com", "https://accounts.google.com"].filter(Boolean),
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

export function securityHeaders({ supabaseUrl, dev }: { supabaseUrl?: string; dev: boolean }) {
  const headers = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy({ supabaseUrl, dev }) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
    { key: "X-Frame-Options", value: "DENY" },
  ];
  if (!dev) headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  return headers;
}
