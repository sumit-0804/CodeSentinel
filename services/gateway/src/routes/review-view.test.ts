import { exampleCombinedReport } from "@code-sentinel/contracts/examples";
import { describe, expect, it } from "vitest";

import type { ReviewRecord } from "../persistence/stores.js";
import { agentResults, toDetail, toListItem } from "./review-view.js";

const record = (overrides: Partial<ReviewRecord> = {}): ReviewRecord => ({
  reviewId: exampleCombinedReport.reviewId,
  organizationId: "6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b9c",
  repositoryId: "2b0c6b0e-0b1a-4f6e-9c3d-1a2b3c4d5e6f",
  repositoryFullName: "octo/api",
  trigger: "github_pull_request",
  prNumber: 4,
  prTitle: "Add payments",
  headSha: "f3326e0",
  status: "completed",
  confidenceThreshold: 0.8,
  createdAt: new Date("2026-10-12T10:00:00Z"),
  report: exampleCombinedReport,
  ...overrides,
});

describe("agentResults", () => {
  it("takes each agent's worst finding at or above the threshold, and clean or not_run otherwise", () => {
    const report = {
      ...exampleCombinedReport,
      agentRuns: [
        { agent: "security" as const, status: "succeeded" as const },
        { agent: "style" as const, status: "succeeded" as const },
        { agent: "logic" as const, status: "timed_out" as const },
      ],
      findings: [
        { ...exampleCombinedReport.findings[0]!, agent: "security" as const, severity: "warning" as const, confidence: 0.9 },
        { ...exampleCombinedReport.findings[0]!, agent: "security" as const, severity: "critical" as const, confidence: 0.95 },
        { ...exampleCombinedReport.findings[0]!, agent: "style" as const, severity: "critical" as const, confidence: 0.5 },
      ],
    };

    expect(agentResults(record({ report }))).toEqual([
      { agent: "security", result: "critical" },
      { agent: "style", result: "clean" },
      { agent: "performance", result: "not_run" },
      { agent: "logic", result: "not_run" },
      { agent: "documentation", result: "not_run" },
    ]);
  });

  it("marks every agent running while a review has no report yet", () => {
    const { report: _report, ...withoutReport } = record({ status: "running" });
    expect(agentResults(withoutReport).every(({ result }) => result === "running")).toBe(true);
  });
});

describe("toListItem / toDetail", () => {
  it("reports a cancelled job as failed and keeps the stored conclusion", () => {
    expect(toListItem(record({ status: "cancelled", checkConclusion: "fail" }))).toMatchObject({ status: "failed", checkConclusion: "fail", pullRequestNumber: 4 });
  });

  it("gives a running review an empty report with zero counts", () => {
    const { report: _report, ...running } = record({ status: "running" });
    const detail = toDetail(running);
    expect(detail).toMatchObject({ status: "running", findings: [], agentRuns: [], summary: { criticalCount: 0 }, pullRequestTitle: "Add payments" });
    expect(toListItem(running).summary.criticalCount).toBe(0);
  });

  it("takes the threshold and identity from the row, not the report", () => {
    const detail = toDetail(record({ confidenceThreshold: 0.65 }));
    expect(detail).toMatchObject({ confidenceThreshold: 0.65, repositoryFullName: "octo/api", headSha: "f3326e0", createdAt: "2026-10-12T10:00:00.000Z" });
  });
});
