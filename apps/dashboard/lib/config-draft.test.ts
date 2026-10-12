import { describe, expect, it } from "vitest";
import type { RepositoryConfig, ReviewDefaults } from "@code-sentinel/contracts";
import {
  branchPatternError,
  defaultsDraftFrom,
  defaultsUpdateFrom,
  everyAgentOff,
  repositoryDraftFrom,
  repositoryUpdateFrom,
  stopFollowingDefaults,
} from "./config-draft";

const PLATFORM = [
  { agent: "security", mode: "block", source: "platform_default" },
  { agent: "style", mode: "comment", source: "platform_default" },
  { agent: "performance", mode: "comment", source: "platform_default" },
  { agent: "logic", mode: "comment", source: "platform_default" },
  { agent: "documentation", mode: "comment", source: "platform_default" },
] as const;

const saved: RepositoryConfig = {
  repositoryId: "8f1c3a92-4c1e-4c22-9a0e-6f2f4b9d0a11",
  fullName: "octo/api",
  defaultBranch: "main",
  reviewEnabled: true,
  useOrgDefaults: true,
  agents: PLATFORM.map((a) => ({ ...a })),
  reviewBranches: [],
  effectiveReviewBranches: ["main"],
  confidenceThresholdOverride: null,
  effectiveConfidenceThreshold: 0.8,
  thresholdSource: "organization_default",
};

const defaults: ReviewDefaults = {
  organizationId: "6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b9c",
  agents: PLATFORM.map((a) => ({ ...a })),
  confidenceThreshold: 0.8,
  reviewBranches: ["main", "release/*"],
};

describe("repositoryUpdateFrom", () => {
  it("sends nothing when nothing changed", () => {
    expect(repositoryUpdateFrom(saved, repositoryDraftFrom(saved))).toEqual({});
  });

  it("sends every mode and the branches when the repository stops following the defaults", () => {
    const draft = stopFollowingDefaults(repositoryDraftFrom(saved), defaults);

    const update = repositoryUpdateFrom(saved, draft);

    expect(update.useOrgDefaults).toBe(false);
    expect(update.agents).toHaveLength(5);
    expect(update.reviewBranches).toEqual(["main", "release/*"]);
  });

  it("sends only the changed agent once the repository has its own modes", () => {
    const own = { ...saved, useOrgDefaults: false };
    const draft = repositoryDraftFrom(own);
    draft.modes.logic = "block";

    expect(repositoryUpdateFrom(own, draft)).toEqual({ agents: [{ agent: "logic", mode: "block" }] });
  });

  it("ignores mode edits while following the defaults, and sends a threshold change or null", () => {
    const draft = repositoryDraftFrom(saved);
    draft.modes.logic = "off";
    draft.thresholdOverride = 0.9;
    expect(repositoryUpdateFrom(saved, draft)).toEqual({ confidenceThresholdOverride: 0.9 });

    const overridden = { ...saved, confidenceThresholdOverride: 0.9 };
    expect(repositoryUpdateFrom(overridden, { ...repositoryDraftFrom(overridden), thresholdOverride: null })).toEqual({ confidenceThresholdOverride: null });
  });

  it("switches back to the defaults without sending modes", () => {
    const own = { ...saved, useOrgDefaults: false };
    expect(repositoryUpdateFrom(own, { ...repositoryDraftFrom(own), useOrgDefaults: true })).toEqual({ useOrgDefaults: true });
  });
});

describe("defaultsUpdateFrom", () => {
  it("sends the changed modes, branches and threshold only", () => {
    const draft = defaultsDraftFrom(defaults);
    expect(defaultsUpdateFrom(defaults, draft)).toEqual({});

    draft.modes.security = "comment";
    draft.reviewBranches = ["main"];
    draft.threshold = 0.7;
    expect(defaultsUpdateFrom(defaults, draft)).toEqual({
      agents: [{ agent: "security", mode: "comment" }],
      reviewBranches: ["main"],
      confidenceThreshold: 0.7,
    });
  });
});

describe("everyAgentOff", () => {
  it("is true only when all five are off", () => {
    const modes = defaultsDraftFrom(defaults).modes;
    expect(everyAgentOff(modes)).toBe(false);
    expect(everyAgentOff({ security: "off", style: "off", performance: "off", logic: "off", documentation: "off" })).toBe(true);
  });
});

describe("branchPatternError", () => {
  it("accepts names and globs, and explains what it refuses", () => {
    expect(branchPatternError("release/*", ["main"])).toBeNull();
    expect(branchPatternError("main", ["main"])).toBe("That branch is already listed.");
    expect(branchPatternError("my branch", [])).toBe("Branch patterns cannot contain spaces");
    expect(branchPatternError("a/../b", [])).toBe("Branch patterns cannot contain '..'");
    expect(branchPatternError("x", Array.from({ length: 20 }, (_, i) => `b${i}`))).toBe("Up to 20 branches.");
  });
});
