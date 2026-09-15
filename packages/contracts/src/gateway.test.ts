import { describe, expect, it } from "vitest";

import { exampleChangedFile, exampleCombinedReport } from "./examples.js";
import {
  AcceptSuggestionRequestSchema,
  ApiKeySchema,
  CreateApiKeyRequestSchema,
  CreateReviewRequestSchema,
  CreatedApiKeySchema,
  CurrentUserSchema,
  RejectSuggestionRequestSchema,
  RepositoryConfigSchema,
  RepositoryConfigUpdateSchema,
  RepositorySchema,
  ReviewAcceptedSchema,
  ReviewListResponseSchema,
  StyleFixesResponseSchema,
  SuggestionDecisionSchema,
  WebhookAcceptedSchema,
} from "./gateway.js";

const REPOSITORY_ID = "2b0c6b0e-0b1a-4f6e-9c3d-1a2b3c4d5e6f";
const REVIEW_ID = exampleCombinedReport.reviewId;
const FINDING_ID = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const KEY_ID = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";

describe("WebhookAcceptedSchema", () => {
  it("accepts an ignored event without a review id", () => {
    expect(WebhookAcceptedSchema.parse({ accepted: true, action: "event_ignored" }).reviewId).toBeUndefined();
  });

  it("rejects an unknown action", () => {
    expect(WebhookAcceptedSchema.safeParse({ accepted: true, action: "queued" }).success).toBe(false);
  });
});

describe("CreateReviewRequestSchema", () => {
  it("accepts an on-demand review", () => {
    const parsed = CreateReviewRequestSchema.parse({
      repositoryId: REPOSITORY_ID,
      files: [exampleChangedFile],
      agents: ["security"],
    });
    expect(parsed.files[0]?.changeType).toBe("modified");
  });

  it("rejects an empty file list", () => {
    expect(CreateReviewRequestSchema.safeParse({ repositoryId: REPOSITORY_ID, files: [] }).success).toBe(false);
  });
});

describe("ReviewAcceptedSchema", () => {
  it("accepts queued with poll and events URLs", () => {
    const parsed = ReviewAcceptedSchema.parse({
      reviewId: REVIEW_ID,
      status: "queued",
      pollUrl: "https://api.codesentinel.dev/v1/reviews/" + REVIEW_ID,
      eventsUrl: "https://api.codesentinel.dev/v1/reviews/" + REVIEW_ID + "/events",
    });
    expect(parsed.status).toBe("queued");
  });

  it("rejects a terminal status", () => {
    expect(ReviewAcceptedSchema.safeParse({ reviewId: REVIEW_ID, status: "completed" }).success).toBe(false);
  });
});

describe("ReviewListResponseSchema", () => {
  it("accepts an empty page (the dashboard empty state)", () => {
    const parsed = ReviewListResponseSchema.parse({ items: [], pageInfo: { total: 0, limit: 25, offset: 0 } });
    expect(parsed.items).toEqual([]);
  });

  it("accepts a populated item and rejects one without a summary", () => {
    const item = {
      reviewId: REVIEW_ID,
      repositoryFullName: "code-sentinel/consumer-api",
      trigger: "github_pull_request",
      pullRequestNumber: 42,
      status: "partial",
      checkConclusion: "neutral",
      summary: exampleCombinedReport.summary,
      createdAt: "2026-09-15T10:29:40Z",
    };
    expect(ReviewListResponseSchema.parse({ items: [item], pageInfo: { total: 1, limit: 25, offset: 0 } }).items).toHaveLength(1);

    const { summary: _ignored, ...withoutSummary } = item;
    const result = ReviewListResponseSchema.safeParse({ items: [withoutSummary], pageInfo: { total: 1, limit: 25, offset: 0 } });
    expect(result.success).toBe(false);
  });
});

describe("StyleFixesResponseSchema", () => {
  it("accepts patched files", () => {
    const parsed = StyleFixesResponseSchema.parse({
      fixedCount: 2,
      files: [{ path: "src/a.ts", content: "export {};\n", fixesApplied: 2 }],
    });
    expect(parsed.fixedCount).toBe(2);
  });

  it("rejects a file without content", () => {
    expect(StyleFixesResponseSchema.safeParse({ fixedCount: 1, files: [{ path: "src/a.ts" }] }).success).toBe(false);
  });
});

describe("suggestion decisions", () => {
  it("defaults the accept target to github_branch", () => {
    expect(AcceptSuggestionRequestSchema.parse({}).target).toBe("github_branch");
  });

  it("rejects an unknown accept target", () => {
    expect(AcceptSuggestionRequestSchema.safeParse({ target: "clipboard" }).success).toBe(false);
  });

  it("accepts a rejection with a reason and rejects an unknown reason", () => {
    expect(RejectSuggestionRequestSchema.parse({ reason: "false_positive", comment: "test code" }).reason).toBe("false_positive");
    expect(RejectSuggestionRequestSchema.safeParse({ reason: "meh" }).success).toBe(false);
  });

  it("accepts a decision and rejects a superseded state", () => {
    const parsed = SuggestionDecisionSchema.parse({
      findingId: FINDING_ID,
      suggestionId: KEY_ID,
      state: "accepted",
      commitSha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      resolvedAt: "2026-09-15T11:00:00Z",
    });
    expect(parsed.commitSha).toBeDefined();
    expect(SuggestionDecisionSchema.safeParse({ findingId: FINDING_ID, suggestionId: KEY_ID, state: "superseded" }).success).toBe(false);
  });
});

describe("RepositorySchema", () => {
  it("accepts a repository", () => {
    const parsed = RepositorySchema.parse({
      repositoryId: REPOSITORY_ID,
      fullName: "code-sentinel/consumer-api",
      defaultBranch: "main",
      isPrivate: true,
      reviewEnabled: true,
    });
    expect(parsed.fullName).toBe("code-sentinel/consumer-api");
  });

  it("rejects a repository without reviewEnabled", () => {
    expect(RepositorySchema.safeParse({ repositoryId: REPOSITORY_ID, fullName: "a/b" }).success).toBe(false);
  });
});

describe("RepositoryConfigSchema", () => {
  it("accepts an inherited threshold with a null override", () => {
    const parsed = RepositoryConfigSchema.parse({
      repositoryId: REPOSITORY_ID,
      agents: [{ agent: "security", enabled: true }],
      confidenceThresholdOverride: null,
      effectiveConfidenceThreshold: 0.8,
      thresholdSource: "platform_default",
    });
    expect(parsed.confidenceThresholdOverride).toBeNull();
  });

  it("rejects an unknown threshold source", () => {
    const result = RepositoryConfigSchema.safeParse({
      repositoryId: REPOSITORY_ID,
      agents: [],
      effectiveConfidenceThreshold: 0.8,
      thresholdSource: "guess",
    });
    expect(result.success).toBe(false);
  });
});

describe("RepositoryConfigUpdateSchema", () => {
  it("accepts an override and accepts null to restore inheritance", () => {
    expect(RepositoryConfigUpdateSchema.parse({ confidenceThresholdOverride: 0.9 }).confidenceThresholdOverride).toBe(0.9);
    expect(RepositoryConfigUpdateSchema.parse({ confidenceThresholdOverride: null }).confidenceThresholdOverride).toBeNull();
  });

  it("rejects disabling every agent by sending an empty list", () => {
    expect(RepositoryConfigUpdateSchema.safeParse({ agents: [] }).success).toBe(false);
  });

  it("rejects an agent timeout outside 1000..120000", () => {
    expect(RepositoryConfigUpdateSchema.safeParse({ agentTimeoutMs: 999 }).success).toBe(false);
  });
});

describe("CurrentUserSchema", () => {
  it("accepts a user with one membership", () => {
    const parsed = CurrentUserSchema.parse({
      userId: KEY_ID,
      githubLogin: "octocat",
      organizations: [{ organizationId: REPOSITORY_ID, displayName: "Code-Sentinel", role: "admin" }],
    });
    expect(parsed.organizations[0]?.role).toBe("admin");
  });

  it("rejects an unknown role", () => {
    const result = CurrentUserSchema.safeParse({
      userId: KEY_ID,
      githubLogin: "octocat",
      organizations: [{ organizationId: REPOSITORY_ID, displayName: "x", role: "owner" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("API keys", () => {
  it("accepts a listed key without a secret and a created key with one", () => {
    const key = { keyId: KEY_ID, label: "Work laptop", keyPrefix: "cs_live_9f2a", createdAt: "2026-09-15T09:00:00Z" };
    expect("secret" in ApiKeySchema.parse({ ...key, secret: "cs_live_9f2a_abc" })).toBe(false);
    expect(CreatedApiKeySchema.parse({ ...key, secret: "cs_live_9f2a_abc" }).secret).toBe("cs_live_9f2a_abc");
  });

  it("rejects an empty label on creation", () => {
    expect(CreateApiKeyRequestSchema.safeParse({ label: "" }).success).toBe(false);
    expect(CreateApiKeyRequestSchema.parse({ label: "Work laptop" }).label).toBe("Work laptop");
  });
});
