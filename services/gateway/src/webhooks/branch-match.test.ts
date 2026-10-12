import { describe, expect, it } from "vitest";

import { matchesReviewBranches } from "./branch-match.js";

describe("matchesReviewBranches", () => {
  it("matches an exact branch name only", () => {
    expect(matchesReviewBranches("main", ["main"])).toBe(true);
    expect(matchesReviewBranches("main-old", ["main"])).toBe(false);
    expect(matchesReviewBranches("feature/main", ["main"])).toBe(false);
  });

  it("lets * match one path segment", () => {
    expect(matchesReviewBranches("release/1.4", ["release/*"])).toBe(true);
    expect(matchesReviewBranches("release/1.4/hotfix", ["release/*"])).toBe(false);
  });

  it("lets ** match any number of segments", () => {
    expect(matchesReviewBranches("hotfix/a/b", ["hotfix/**"])).toBe(true);
    expect(matchesReviewBranches("feature/x/y", ["*"])).toBe(false);
    expect(matchesReviewBranches("feature/x/y", ["**"])).toBe(true);
  });

  it("is case-sensitive and matches nothing without patterns", () => {
    expect(matchesReviewBranches("Main", ["main"])).toBe(false);
    expect(matchesReviewBranches("main", [])).toBe(false);
  });

  it("matches when any pattern does", () => {
    expect(matchesReviewBranches("develop", ["main", "develop", "release/*"])).toBe(true);
  });
});
