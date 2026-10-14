import { describe, expect, it } from "vitest";
import { rerunFailureMessage } from "./rerun-messages";

describe("rerunFailureMessage", () => {
  it("explains the gateway's refusals in plain words", () => {
    expect(rerunFailureMessage({ reason: "error", code: "review_in_progress" })).toMatch(/just started/);
    expect(rerunFailureMessage({ reason: "error", code: "no_reviewable_files" })).toMatch(/nothing to review/);
    expect(rerunFailureMessage({ reason: "error", code: "branch_ignored" })).toMatch(/Branches to review/);
  });

  it("falls back on how the call failed, and never shows an unknown code", () => {
    expect(rerunFailureMessage({ reason: "unreachable" })).toMatch(/Couldn't reach the API/);
    expect(rerunFailureMessage({ reason: "error", code: "something_new" })).toBe("The review couldn't be started. Try again in a moment.");
  });
});
