import { describe, expect, it } from "vitest";
import { isAppRoute, isGuestOnlyRoute } from "@/lib/routes";

describe("routes", () => {
  it("matches whole path segments only", () => {
    expect(isAppRoute("/settings/security")).toBe(true);
    expect(isAppRoute("/step-up")).toBe(true);
    expect(isAppRoute("/settingsx")).toBe(false);
    expect(isGuestOnlyRoute("/sign-in")).toBe(true);
    expect(isGuestOnlyRoute("/sign-up/extra")).toBe(true);
    expect(isGuestOnlyRoute("/overview")).toBe(false);
  });
});
