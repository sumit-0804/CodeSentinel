import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./csp";

describe("security headers", () => {
  it("locks framing and allows the OAuth redirect chain", () => {
    const csp = contentSecurityPolicy({ supabaseUrl: "https://ref.supabase.co/", dev: false });
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self' https://ref.supabase.co https://github.com https://accounts.google.com");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("allows eval and websockets only in development", () => {
    const csp = contentSecurityPolicy({ dev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws:");
  });

  it("sends HSTS in production only", () => {
    const names = (dev: boolean) => securityHeaders({ dev }).map((h) => h.key);
    expect(names(false)).toContain("Strict-Transport-Security");
    expect(names(true)).not.toContain("Strict-Transport-Security");
  });
});
