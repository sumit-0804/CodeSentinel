import { describe, expect, it } from "vitest";

import { CombinedReportSchema } from "./common.js";
import { exampleCombinedReport } from "./examples.js";
import {
  AgentsHealthSchema,
  AuditEventListSchema,
  CurrentUserSchema,
  RejectSuggestionRequestSchema,
  RepositoryConfigSchema,
  RepositoryConfigUpdateSchema,
  RepositorySchema,
  ReviewAcceptedSchema,
  SessionListSchema,
  ReviewDetailSchema,
  ReviewListQuerySchema,
  ReviewListResponseSchema,
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

describe("ReviewListQuerySchema", () => {
  it("defaults the page, splits statuses and reads latest", () => {
    expect(ReviewListQuerySchema.parse({})).toEqual({ limit: 25, offset: 0 });
    expect(ReviewListQuerySchema.parse({ status: "running,failed", latest: "true", limit: "10" })).toMatchObject({
      status: ["running", "failed"],
      latest: true,
      limit: 10,
    });
  });

  it("rejects an unknown status, a limit over 100 and a bad repository id", () => {
    expect(ReviewListQuerySchema.safeParse({ status: "done" }).success).toBe(false);
    expect(ReviewListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(ReviewListQuerySchema.safeParse({ repositoryId: "abc" }).success).toBe(false);
  });
});

describe("ReviewDetailSchema", () => {
  it("is a CombinedReport with where it came from", () => {
    const detail = ReviewDetailSchema.parse({
      ...exampleCombinedReport,
      repositoryId: REPOSITORY_ID,
      repositoryFullName: "code-sentinel/consumer-api",
      trigger: "github_pull_request",
      checkConclusion: "fail",
      agentResults: [{ agent: "security", result: "critical" }],
      createdAt: "2026-09-15T10:29:40Z",
    });
    expect(CombinedReportSchema.parse(detail).findings).toHaveLength(exampleCombinedReport.findings.length);
  });
});

describe("suggestion decisions", () => {
  it("accepts a rejection with a reason and rejects an unknown reason or an overlong comment", () => {
    expect(RejectSuggestionRequestSchema.parse({ reason: "false_positive", comment: "test code" }).reason).toBe("false_positive");
    expect(RejectSuggestionRequestSchema.safeParse({ reason: "meh" }).success).toBe(false);
    expect(RejectSuggestionRequestSchema.safeParse({ comment: "x".repeat(1001) }).success).toBe(false);
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
  const config = {
    repositoryId: REPOSITORY_ID,
    fullName: "octo-org/api",
    defaultBranch: "main",
    reviewEnabled: true,
    useOrgDefaults: true,
    agents: [{ agent: "security", mode: "block", source: "platform_default" }],
    reviewBranches: [],
    effectiveReviewBranches: ["main"],
    confidenceThresholdOverride: null,
    effectiveConfidenceThreshold: 0.8,
    thresholdSource: "platform_default",
  };

  it("accepts an inherited threshold with a null override", () => {
    expect(RepositoryConfigSchema.parse(config).confidenceThresholdOverride).toBeNull();
  });

  it("rejects an unknown threshold source or agent mode", () => {
    expect(RepositoryConfigSchema.safeParse({ ...config, thresholdSource: "guess" }).success).toBe(false);
    expect(RepositoryConfigSchema.safeParse({ ...config, agents: [{ agent: "security", mode: "on", source: "repository" }] }).success).toBe(false);
  });
});

describe("RepositoryConfigUpdateSchema", () => {
  it("accepts an override and accepts null to restore inheritance", () => {
    expect(RepositoryConfigUpdateSchema.parse({ confidenceThresholdOverride: 0.9 }).confidenceThresholdOverride).toBe(0.9);
    expect(RepositoryConfigUpdateSchema.parse({ confidenceThresholdOverride: null }).confidenceThresholdOverride).toBeNull();
  });

  it("rejects an empty or repeated agent list", () => {
    expect(RepositoryConfigUpdateSchema.safeParse({ agents: [] }).success).toBe(false);
    const repeated = [
      { agent: "logic", mode: "off" },
      { agent: "logic", mode: "block" },
    ];
    expect(RepositoryConfigUpdateSchema.safeParse({ agents: repeated }).success).toBe(false);
  });

  it("rejects an agent timeout outside 1000..120000", () => {
    expect(RepositoryConfigUpdateSchema.safeParse({ agentTimeoutMs: 999 }).success).toBe(false);
  });

  it("accepts branch globs and rejects spaces, '..', long patterns and more than 20", () => {
    expect(RepositoryConfigUpdateSchema.safeParse({ reviewBranches: ["main", "release/*", "hotfix/**"] }).success).toBe(true);
    for (const bad of ["my branch", "a/../b", "", "x".repeat(101)]) {
      expect(RepositoryConfigUpdateSchema.safeParse({ reviewBranches: [bad] }).success).toBe(false);
    }
    expect(RepositoryConfigUpdateSchema.safeParse({ reviewBranches: Array.from({ length: 21 }, (_, i) => `b${i}`) }).success).toBe(false);
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

  it("accepts a user who has not linked GitHub", () => {
    expect(CurrentUserSchema.safeParse({ userId: KEY_ID, email: "a@example.test", organizations: [] }).success).toBe(true);
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

describe("SessionListSchema", () => {
  it("accepts a session with only what Supabase always records", () => {
    const parsed = SessionListSchema.parse({ items: [{ sessionId: KEY_ID, createdAt: "2026-10-19T10:00:00.000Z", current: true }] });
    expect(parsed.items[0]?.current).toBe(true);
  });
});

describe("AgentsHealthSchema", () => {
  it("accepts unknown when the orchestrator did not answer, and rejects other statuses", () => {
    expect(AgentsHealthSchema.safeParse({ agents: [{ agent: "logic", status: "unknown" }] }).success).toBe(true);
    expect(AgentsHealthSchema.safeParse({ agents: [{ agent: "logic", status: "down" }] }).success).toBe(false);
  });
});

describe("AuditEventListSchema", () => {
  it("accepts an event from GitHub with no user, and rejects an unknown action", () => {
    const event = { eventId: KEY_ID, action: "fixes_applied", targetType: "review", targetId: REVIEW_ID, metadata: { githubLogin: "octocat" }, createdAt: "2026-10-19T10:00:00.000Z" };
    expect(AuditEventListSchema.safeParse({ items: [event], nextBefore: "2026-10-19T09:00:00.000Z" }).success).toBe(true);
    expect(AuditEventListSchema.safeParse({ items: [{ ...event, action: "deleted_everything" }] }).success).toBe(false);
  });
});
