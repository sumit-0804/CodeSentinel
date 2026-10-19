import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@code-sentinel/contracts";

import { describeAuditEvent } from "./audit-view";

const event = (action: AuditEvent["action"], metadata?: Record<string, unknown>): AuditEvent => ({
  eventId: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
  action,
  createdAt: "2026-10-19T10:00:00.000Z",
  ...(metadata ? { metadata } : {}),
});

describe("describeAuditEvent", () => {
  it("names the settings that changed", () => {
    expect(describeAuditEvent(event("repository_config_updated", { changed: ["confidenceThresholdOverride", "agents"] }))).toBe(
      "Changed repository settings: threshold, agents",
    );
    expect(describeAuditEvent(event("repository_reviews_toggled", { reviewEnabled: false }))).toBe("Switched reviews off");
  });

  it("says where fixes went and how", () => {
    expect(describeAuditEvent(event("fixes_applied", { repository: "acme/api", pullRequestNumber: 8, applied: 3, via: "check_run" }))).toBe(
      "Applied 3 fixes on acme/api#8 from the Check Run",
    );
    expect(describeAuditEvent(event("fix_rejected", { reason: "false_positive" }))).toBe("Dismissed a fix (false positive)");
    expect(describeAuditEvent(event("review_rerun", { repository: "acme/api", pullRequestNumber: 2 }))).toBe("Re-ran a review on acme/api#2");
  });

  it("falls back to the action when there's no detail", () => {
    expect(describeAuditEvent(event("session_revoked"))).toBe("Signed out a device");
    expect(describeAuditEvent(event("step_up_refused", { method: "PUT", path: "/v1/repositories/x/config" }))).toBe(
      "Was asked for an authenticator code (PUT /v1/repositories/x/config)",
    );
  });
});
