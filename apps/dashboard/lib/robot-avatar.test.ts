import { describe, expect, it } from "vitest";
import { robotAvatarDataUri } from "./robot-avatar";

describe("robotAvatarDataUri", () => {
  it("draws the same robot for the same user and a different one for another", () => {
    const a = robotAvatarDataUri("7d3c1a90-0000-4000-8000-000000000001");
    expect(robotAvatarDataUri("7d3c1a90-0000-4000-8000-000000000001")).toBe(a);
    expect(robotAvatarDataUri("7d3c1a90-0000-4000-8000-000000000002")).not.toBe(a);
  });

  it("returns an inline SVG that doesn't carry the seed", () => {
    const uri = robotAvatarDataUri("user-secret-id-42");
    expect(uri.startsWith("data:image/svg+xml")).toBe(true);
    expect(decodeURIComponent(uri)).not.toContain("user-secret-id-42");
  });
});
