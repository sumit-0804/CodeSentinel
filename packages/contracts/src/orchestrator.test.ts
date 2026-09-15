import { describe, expect, it } from "vitest";

import { exampleCombinedReport, exampleReviewJobRequest } from "./examples.js";
import {
  AgentHealthSnapshotSchema,
  ReviewJobRequestSchema,
  ReviewJobSchema,
  type ReviewJobRequestInput,
} from "./orchestrator.js";

const JOB_ID = "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f";

describe("ReviewJobRequestSchema", () => {
  it("parses the example request", () => {
    expect(ReviewJobRequestSchema.parse(exampleReviewJobRequest)).toEqual(exampleReviewJobRequest);
  });

  it("applies the documented defaults", () => {
    const minimal: ReviewJobRequestInput = {
      repositoryId: exampleReviewJobRequest.repositoryId,
      organizationId: exampleReviewJobRequest.organizationId,
      trigger: "vscode_on_demand",
      headSha: exampleReviewJobRequest.headSha,
      files: exampleReviewJobRequest.files,
    };
    const parsed = ReviewJobRequestSchema.parse(minimal);
    expect(parsed.agentTimeoutMs).toBe(20000);
    expect(parsed.includeSimilarPastIssues).toBe(true);
    expect(parsed.enabledAgents).toBeUndefined();
  });

  it("rejects an empty file list (the gateway finishes those reviews itself)", () => {
    expect(ReviewJobRequestSchema.safeParse({ ...exampleReviewJobRequest, files: [] }).success).toBe(false);
  });

  it("rejects an agent timeout outside 1000..120000", () => {
    expect(ReviewJobRequestSchema.safeParse({ ...exampleReviewJobRequest, agentTimeoutMs: 500 }).success).toBe(false);
    expect(ReviewJobRequestSchema.safeParse({ ...exampleReviewJobRequest, agentTimeoutMs: 120001 }).success).toBe(false);
  });

  it("rejects a non-uuid repository id", () => {
    expect(ReviewJobRequestSchema.safeParse({ ...exampleReviewJobRequest, repositoryId: "repo-1" }).success).toBe(false);
  });

  it("rejects a callback that is not a URL", () => {
    expect(ReviewJobRequestSchema.safeParse({ ...exampleReviewJobRequest, callbackUrl: "not a url" }).success).toBe(false);
  });
});

describe("ReviewJobSchema", () => {
  it("accepts a running job with partial agentRuns", () => {
    const parsed = ReviewJobSchema.parse({
      jobId: JOB_ID,
      reviewId: exampleCombinedReport.reviewId,
      status: "running",
      createdAt: "2026-09-15T10:29:40Z",
      startedAt: "2026-09-15T10:29:41Z",
      agentRuns: [{ agent: "style", status: "succeeded", findingsCount: 0 }],
    });
    expect(parsed.report).toBeUndefined();
  });

  it("accepts a finished job carrying the report, and a cancelled one", () => {
    const finished = ReviewJobSchema.parse({
      jobId: JOB_ID,
      reviewId: exampleCombinedReport.reviewId,
      status: "partial",
      createdAt: "2026-09-15T10:29:40Z",
      completedAt: "2026-09-15T10:30:00Z",
      report: exampleCombinedReport,
    });
    expect(finished.report?.findings).toHaveLength(1);

    const cancelled = ReviewJobSchema.parse({
      jobId: JOB_ID,
      reviewId: exampleCombinedReport.reviewId,
      status: "cancelled",
      createdAt: "2026-09-15T10:29:40Z",
    });
    expect(cancelled.status).toBe("cancelled");
  });

  it("rejects a job without createdAt", () => {
    const result = ReviewJobSchema.safeParse({ jobId: JOB_ID, reviewId: exampleCombinedReport.reviewId, status: "queued" });
    expect(result.success).toBe(false);
  });
});

describe("AgentHealthSnapshotSchema", () => {
  it("accepts a snapshot", () => {
    const parsed = AgentHealthSnapshotSchema.parse({
      checkedAt: "2026-09-15T10:00:00Z",
      agents: [
        { agent: "security", status: "ok", latencyMs: 12, version: "1.0.0" },
        { agent: "documentation", status: "unavailable" },
      ],
    });
    expect(parsed.agents).toHaveLength(2);
  });

  it("rejects an unknown agent status", () => {
    const result = AgentHealthSnapshotSchema.safeParse({
      checkedAt: "2026-09-15T10:00:00Z",
      agents: [{ agent: "security", status: "flaky" }],
    });
    expect(result.success).toBe(false);
  });
});
