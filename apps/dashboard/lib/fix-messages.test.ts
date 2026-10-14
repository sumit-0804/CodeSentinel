import { describe, expect, it } from "vitest";
import { fixFailureMessage } from "./fix-messages";

describe("fixFailureMessage", () => {
  it("explains why a fix can't be committed", () => {
    expect(fixFailureMessage({ reason: "error", code: "head_moved" })).toMatch(/newer commits/);
    expect(fixFailureMessage({ reason: "error", code: "fork_not_supported" })).toMatch(/fork/);
    expect(fixFailureMessage({ reason: "error", code: "github_permission_missing" })).toMatch(/Contents: Read and write/);
  });

  it("falls back on how the call failed, and never shows an unknown code", () => {
    expect(fixFailureMessage({ reason: "unreachable" })).toMatch(/Couldn't reach the API/);
    expect(fixFailureMessage({ reason: "error", code: "something_new" })).toBe("That didn't work. Try again in a moment.");
  });
});
