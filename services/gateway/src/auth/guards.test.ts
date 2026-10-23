import { HttpError } from "@code-sentinel/service-kit";
import { describe, expect, it } from "vitest";

import { assertStepUp } from "./guards.js";
import type { Principal } from "./principal.js";

const NOW = new Date("2026-10-12T12:00:00Z");
const policy = { minutes: 10, now: () => NOW };
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

const session = (aal: string, amr: Principal["amr"], mfaEnrolled = true): Principal => ({ userId: "u", sessionId: "s", aal, amr, mfaEnrolled, providers: [] });
const totp = (ageSeconds: number) => ({ method: "totp", timestamp: seconds(NOW) - ageSeconds });

function codeOf(run: () => void): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof HttpError ? `${error.status} ${error.code}` : "other";
  }
}

describe("assertStepUp", () => {
  it("accepts aal2 with a TOTP code up to the limit, including exactly 10 minutes old", () => {
    expect(codeOf(() => assertStepUp(session("aal2", [totp(30)]), policy))).toBeUndefined();
    expect(codeOf(() => assertStepUp(session("aal2", [totp(600)]), policy))).toBeUndefined();
  });

  it("answers 403 mfa_required for a stale code, aal1, aal2 without TOTP, or no sign-in methods", () => {
    expect(codeOf(() => assertStepUp(session("aal2", [totp(601)]), policy))).toBe("403 mfa_required");
    expect(codeOf(() => assertStepUp(session("aal1", [{ method: "password", timestamp: seconds(NOW) }]), policy))).toBe("403 mfa_required");
    expect(codeOf(() => assertStepUp(session("aal2", [{ method: "password", timestamp: seconds(NOW) }]), policy))).toBe("403 mfa_required");
    expect(codeOf(() => assertStepUp(session("aal1", []), policy))).toBe("403 mfa_required");
  });

  it("ignores a TOTP entry on an aal1 token", () => {
    expect(codeOf(() => assertStepUp(session("aal1", [totp(5)]), policy))).toBe("403 mfa_required");
  });

  it("asks nothing of a user without an authenticator app, which is optional", () => {
    expect(codeOf(() => assertStepUp(session("aal1", [{ method: "password", timestamp: seconds(NOW) }], false), policy))).toBeUndefined();
  });
});
