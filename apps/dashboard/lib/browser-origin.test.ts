import { describe, expect, it } from "vitest";

import { browserOrigin, supabaseOriginHeaders } from "./browser-origin";

describe("browserOrigin", () => {
  it("takes the first X-Forwarded-For hop, the browser, and its User-Agent", () => {
    const incoming = new Headers({ "x-forwarded-for": "110.226.114.105, 76.76.21.21", "user-agent": "Mozilla/5.0 Chrome" });

    expect(browserOrigin(incoming)).toEqual({ ip: "110.226.114.105", userAgent: "Mozilla/5.0 Chrome" });
    expect(supabaseOriginHeaders(incoming)).toEqual({ "User-Agent": "Mozilla/5.0 Chrome", "Sb-Forwarded-For": "110.226.114.105" });
  });

  it("falls back to X-Real-IP and leaves out what it doesn't know", () => {
    expect(browserOrigin(new Headers({ "x-real-ip": "203.0.113.7" }))).toEqual({ ip: "203.0.113.7" });
    expect(supabaseOriginHeaders(new Headers())).toEqual({});
  });
});
