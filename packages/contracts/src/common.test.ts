import { describe, expect, it } from "vitest";

import {
  AgentRunSummarySchema,
  ApiErrorSchema,
  ChangedFileSchema,
  CodeLocationSchema,
  CombinedReportSchema,
  ConfidenceSchema,
  FindingSchema,
  PageInfoSchema,
  ReportSkippedFileSchema,
  ReviewCoverageSchema,
  ReviewSummarySchema,
  SimilarPastIssueSchema,
  SkippedFileSchema,
  SuggestionSchema,
} from "./common.js";
import { exampleChangedFile, exampleCombinedReport, exampleFinding } from "./examples.js";

describe("ConfidenceSchema", () => {
  it("accepts the bounds", () => {
    expect(ConfidenceSchema.parse(0)).toBe(0);
    expect(ConfidenceSchema.parse(1)).toBe(1);
  });

  it("rejects values outside [0, 1]", () => {
    expect(ConfidenceSchema.safeParse(1.2).success).toBe(false);
    expect(ConfidenceSchema.safeParse(-0.1).success).toBe(false);
  });
});

describe("CodeLocationSchema", () => {
  it("accepts a one-line location", () => {
    expect(
      CodeLocationSchema.parse({ filePath: "src/pay.ts", lineStart: 10, lineEnd: 10 }),
    ).toEqual({ filePath: "src/pay.ts", lineStart: 10, lineEnd: 10 });
  });

  it("rejects line numbers below 1", () => {
    const result = CodeLocationSchema.safeParse({ filePath: "src/pay.ts", lineStart: 0, lineEnd: 1 });
    expect(result.success).toBe(false);
  });
});

describe("ChangedFileSchema", () => {
  it("parses the agent.yaml example and defaults changeType to modified", () => {
    const { changeType: _ignored, ...withoutChangeType } = exampleChangedFile;
    const parsed = ChangedFileSchema.parse(withoutChangeType);
    expect(parsed.changeType).toBe("modified");
    expect(parsed.patch).toBe(exampleChangedFile.patch);
  });

  it("rejects a file without a patch", () => {
    const result = ChangedFileSchema.safeParse({ path: "a.ts", language: "typescript" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown language", () => {
    const result = ChangedFileSchema.safeParse({ path: "a.rs", language: "rust", patch: "" });
    expect(result.success).toBe(false);
  });
});

describe("SkippedFileSchema", () => {
  it("accepts every documented reason", () => {
    for (const reason of ["unsupported_language", "too_large", "generated_file", "binary", "over_budget"]) {
      expect(SkippedFileSchema.parse({ path: "x", reason }).reason).toBe(reason);
    }
  });

  it("rejects an unknown reason", () => {
    expect(SkippedFileSchema.safeParse({ path: "x", reason: "split" }).success).toBe(false);
  });
});

describe("ReportSkippedFileSchema", () => {
  it("accepts a gateway skip with no agents and an agent skip with agents", () => {
    expect(ReportSkippedFileSchema.parse({ path: "x", reason: "binary" }).agents).toBeUndefined();
    expect(
      ReportSkippedFileSchema.parse({ path: "x", reason: "too_large", agents: ["security", "logic"] })
        .agents,
    ).toEqual(["security", "logic"]);
  });

  it("rejects an unknown agent", () => {
    const result = ReportSkippedFileSchema.safeParse({ path: "x", reason: "too_large", agents: ["lint"] });
    expect(result.success).toBe(false);
  });
});

describe("ReviewCoverageSchema", () => {
  it("accepts the example coverage", () => {
    expect(ReviewCoverageSchema.parse(exampleCombinedReport.coverage)).toEqual(exampleCombinedReport.coverage);
  });

  it("rejects a missing count", () => {
    const result = ReviewCoverageSchema.safeParse({ filesTotal: 2, filesReviewed: 1 });
    expect(result.success).toBe(false);
  });
});

describe("SuggestionSchema", () => {
  it("accepts a deterministic fix without optional fields", () => {
    const parsed = SuggestionSchema.parse({
      kind: "deterministic",
      originalSnippet: "a",
      suggestedSnippet: "b",
    });
    expect(parsed.state).toBeUndefined();
  });

  it("rejects an unknown kind", () => {
    const result = SuggestionSchema.safeParse({ kind: "manual", originalSnippet: "a", suggestedSnippet: "b" });
    expect(result.success).toBe(false);
  });
});

describe("SimilarPastIssueSchema", () => {
  it("accepts a match", () => {
    const parsed = SimilarPastIssueSchema.parse({
      findingId: "8f1c3a92-4c1e-4c22-9a0e-6f2f4b9d0a11",
      similarityScore: 0.87,
      title: "SQL built from an f-string",
      occurredAt: "2026-08-01T09:00:00Z",
    });
    expect(parsed.similarityScore).toBe(0.87);
  });

  it("rejects a non-uuid finding id", () => {
    const result = SimilarPastIssueSchema.safeParse({ findingId: "42", similarityScore: 0.5, title: "x" });
    expect(result.success).toBe(false);
  });
});

describe("FindingSchema", () => {
  it("parses the example finding", () => {
    expect(FindingSchema.parse(exampleFinding)).toEqual(exampleFinding);
  });

  it("rejects confidence above 1", () => {
    expect(FindingSchema.safeParse({ ...exampleFinding, confidence: 1.2 }).success).toBe(false);
  });

  it("rejects duplicateCount below 1", () => {
    expect(FindingSchema.safeParse({ ...exampleFinding, duplicateCount: 0 }).success).toBe(false);
  });

  it("strips unknown keys", () => {
    const parsed = FindingSchema.parse({ ...exampleFinding, internalScore: 3 });
    expect("internalScore" in parsed).toBe(false);
  });
});

describe("AgentRunSummarySchema", () => {
  it("accepts a quota-deferred run", () => {
    const parsed = AgentRunSummarySchema.parse({
      agent: "logic",
      status: "skipped",
      errorCode: "llm_quota_exhausted",
    });
    expect(parsed.errorCode).toBe("llm_quota_exhausted");
  });

  it("rejects an unknown status", () => {
    expect(AgentRunSummarySchema.safeParse({ agent: "logic", status: "crashed" }).success).toBe(false);
  });
});

describe("ReviewSummarySchema", () => {
  it("accepts the example summary", () => {
    expect(ReviewSummarySchema.parse(exampleCombinedReport.summary)).toEqual(exampleCombinedReport.summary);
  });

  it("rejects negative counts", () => {
    const result = ReviewSummarySchema.safeParse({ ...exampleCombinedReport.summary, criticalCount: -1 });
    expect(result.success).toBe(false);
  });
});

describe("CombinedReportSchema", () => {
  it("parses the example report", () => {
    expect(CombinedReportSchema.parse(exampleCombinedReport)).toEqual(exampleCombinedReport);
  });

  it("rejects a report without agentRuns", () => {
    const { agentRuns: _ignored, ...withoutRuns } = exampleCombinedReport;
    expect(CombinedReportSchema.safeParse(withoutRuns).success).toBe(false);
  });

  it("rejects cancelled, which is a job status not a report status", () => {
    expect(CombinedReportSchema.safeParse({ ...exampleCombinedReport, status: "cancelled" }).success).toBe(false);
  });
});

describe("ApiErrorSchema", () => {
  it("accepts code, message and details", () => {
    const parsed = ApiErrorSchema.parse({
      code: "invalid_signature",
      message: "Signature verification failed.",
      details: { header: "X-Hub-Signature-256" },
      requestId: "req-1",
    });
    expect(parsed.code).toBe("invalid_signature");
  });

  it("rejects a missing message", () => {
    expect(ApiErrorSchema.safeParse({ code: "x" }).success).toBe(false);
  });
});

describe("PageInfoSchema", () => {
  it("accepts a page", () => {
    expect(PageInfoSchema.parse({ total: 40, limit: 25, offset: 0 })).toEqual({ total: 40, limit: 25, offset: 0 });
  });

  it("rejects a fractional offset", () => {
    expect(PageInfoSchema.safeParse({ total: 40, limit: 25, offset: 0.5 }).success).toBe(false);
  });
});
