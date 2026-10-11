import { describe, expect, it } from "vitest";
import { parseEnv, parseGatewayUrl } from "./env";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3001/",
};

describe("parseEnv", () => {
  it("accepts a complete env and trims the site URL's trailing slash", () => {
    expect(parseEnv(valid).NEXT_PUBLIC_SITE_URL).toBe("http://localhost:3001");
  });

  it("names every missing variable", () => {
    expect(() => parseEnv({})).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_SITE_URL/,
    );
  });

  it("rejects a site URL that isn't a URL", () => {
    expect(() => parseEnv({ ...valid, NEXT_PUBLIC_SITE_URL: "localhost:3001" })).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });
});

describe("parseGatewayUrl", () => {
  it("is optional and drops a trailing slash", () => {
    expect(parseGatewayUrl(undefined)).toBeUndefined();
    expect(parseGatewayUrl("  ")).toBeUndefined();
    expect(parseGatewayUrl("http://localhost:3000/")).toBe("http://localhost:3000");
  });

  it("rejects a value that isn't an http URL", () => {
    expect(() => parseGatewayUrl("localhost:3000")).toThrow(/GATEWAY_URL/);
  });
});
