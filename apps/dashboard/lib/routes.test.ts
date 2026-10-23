import { describe, expect, it } from "vitest";
import { isAppRoute, isGuestOnlyRoute, isVerifyCodeRoute } from "@/lib/routes";

describe("routes", () => {
  it("keeps the sign-in code page apart from app pages and guest-only pages", () => {
    expect(isVerifyCodeRoute("/verify-code")).toBe(true);
    expect(isAppRoute("/verify-code")).toBe(false);
    expect(isGuestOnlyRoute("/verify-code")).toBe(false);
  });

  it("matches whole path segments only", () => {
    expect(isAppRoute("/settings/security")).toBe(true);
    expect(isAppRoute("/settingsx")).toBe(false);
    expect(isVerifyCodeRoute("/verify-codes")).toBe(false);
    expect(isGuestOnlyRoute("/sign-in")).toBe(true);
  });
});
