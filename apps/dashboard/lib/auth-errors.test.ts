import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./auth-errors";

describe("authErrorMessage", () => {
  it("maps known Supabase codes to plain sentences", () => {
    expect(authErrorMessage({ code: "invalid_credentials" })).toMatch(/don't match an account/);
    expect(authErrorMessage({ code: "email_not_confirmed" })).toMatch(/Confirm your email/);
  });

  it("treats any 429 as a rate limit", () => {
    expect(authErrorMessage({ status: 429, code: "something_new" })).toMatch(/Too many attempts/);
  });

  it("never echoes the raw server message", () => {
    const message = authErrorMessage({ code: "unexpected", message: "relation auth.users does not exist" });
    expect(message).not.toMatch(/relation/);
    expect(authErrorMessage(null)).toMatch(/Try again/);
  });
});
