import { describe, expect, it } from "vitest";

import type { AgentRunSummary } from "@code-sentinel/contracts";
import { exampleFinding } from "@code-sentinel/contracts/examples";
import { aggregate, deriveStatus } from "./index.js";

const REVIEW_ID = "8f1c3a92-4c1e-4c22-9a0e-6f2f4b9d0a11";

function runs(...statuses: AgentRunSummary["status"][]): AgentRunSummary[] {
  const agents = ["security", "style", "performance", "logic", "documentation"] as const;
  return statuses.map((status, i) => ({ agent: agents[i]!, status }));
}

describe("deriveStatus", () => {
  it("is completed when every agent succeeded", () => {
    expect(deriveStatus(runs("succeeded", "succeeded"))).toBe("completed");
  });

  it("is partial when one agent timed out", () => {
    expect(deriveStatus(runs("succeeded", "timed_out"))).toBe("partial");
  });

  it("is partial when one agent failed", () => {
    expect(deriveStatus(runs("failed", "succeeded"))).toBe("partial");
  });

  it("is completed when the only non-success is a skipped agent", () => {
    expect(deriveStatus(runs("succeeded", "skipped"))).toBe("completed");
  });

  it("is failed when every agent failed", () => {
    expect(deriveStatus(runs("failed", "timed_out", "failed"))).toBe("failed");
  });

  it("is failed when there are no runs", () => {
    expect(deriveStatus([])).toBe("failed");
  });
});

describe("aggregate", () => {
  it("derives the status from the runs when none is given", () => {
    const report = aggregate({
      reviewId: REVIEW_ID,
      rawFindings: [exampleFinding],
      agentRuns: runs("succeeded", "timed_out"),
    });

    expect(report.status).toBe("partial");
  });

  it("includes skippedFiles only when non-empty", () => {
    const base = { reviewId: REVIEW_ID, rawFindings: [], agentRuns: runs("succeeded") };

    expect(aggregate({ ...base, skippedFiles: [] })).not.toHaveProperty("skippedFiles");
    expect(aggregate(base)).not.toHaveProperty("skippedFiles");
    expect(
      aggregate({ ...base, skippedFiles: [{ path: "package-lock.json", reason: "generated_file" }] }).skippedFiles,
    ).toEqual([{ path: "package-lock.json", reason: "generated_file" }]);
  });
});
