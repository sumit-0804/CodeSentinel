import { describe, expect, it } from "vitest";

import {
  AgentReviewRequestSchema,
  AgentReviewResponseSchema,
  CapabilitiesSchema,
  HealthSchema,
} from "./agent.js";
import {
  exampleAgentReviewRequest,
  exampleAgentReviewResponse,
  exampleChangedFile,
  exampleFinding,
} from "./examples.js";

describe("AgentReviewRequestSchema", () => {
  it("parses the pythonDiff example from agent.yaml", () => {
    expect(AgentReviewRequestSchema.parse(exampleAgentReviewRequest)).toEqual(exampleAgentReviewRequest);
  });

  it("keeps agent-specific options (additionalProperties: true)", () => {
    const parsed = AgentReviewRequestSchema.parse(exampleAgentReviewRequest);
    expect(parsed.options).toMatchObject({ autoFix: true, includeDocstringDrafts: true, deadlineMs: 18000 });
  });

  it("rejects an empty file list", () => {
    expect(AgentReviewRequestSchema.safeParse({ ...exampleAgentReviewRequest, files: [] }).success).toBe(false);
  });

  it("rejects more than 200 files", () => {
    const files = Array.from({ length: 201 }, () => exampleChangedFile);
    expect(AgentReviewRequestSchema.safeParse({ ...exampleAgentReviewRequest, files }).success).toBe(false);
  });

  it("rejects a negative deadline", () => {
    const result = AgentReviewRequestSchema.safeParse({
      ...exampleAgentReviewRequest,
      options: { deadlineMs: -1 },
    });
    expect(result.success).toBe(false);
  });
});

describe("AgentReviewResponseSchema", () => {
  it("parses the example response", () => {
    expect(AgentReviewResponseSchema.parse(exampleAgentReviewResponse)).toEqual(exampleAgentReviewResponse);
  });

  it("accepts an empty findings array as a successful result", () => {
    const parsed = AgentReviewResponseSchema.parse({
      reviewId: exampleAgentReviewResponse.reviewId,
      agent: "style",
      findings: [],
    });
    expect(parsed.findings).toEqual([]);
    expect(parsed.llm).toBeUndefined();
  });

  it("rejects a finding with a bad location inside the response", () => {
    const result = AgentReviewResponseSchema.safeParse({
      ...exampleAgentReviewResponse,
      findings: [{ ...exampleFinding, location: { filePath: "x", lineStart: 0, lineEnd: 0 } }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing agent", () => {
    const { agent: _ignored, ...withoutAgent } = exampleAgentReviewResponse;
    expect(AgentReviewResponseSchema.safeParse(withoutAgent).success).toBe(false);
  });
});

describe("CapabilitiesSchema", () => {
  it("accepts a full descriptor", () => {
    const parsed = CapabilitiesSchema.parse({
      agent: "security",
      version: "1.0.0",
      languages: ["javascript", "typescript", "python"],
      usesLlm: true,
      producesDeterministicFixes: false,
      maxDiffBytes: 512000,
      maxFileTokens: 6000,
      rules: [{ ruleId: "security/sql-injection", title: "SQL injection", defaultSeverity: "critical" }],
    });
    expect(parsed.maxFileTokens).toBe(6000);
  });

  it("rejects a rule without a default severity", () => {
    const result = CapabilitiesSchema.safeParse({
      agent: "security",
      version: "1.0.0",
      languages: ["python"],
      rules: [{ ruleId: "security/x" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("HealthSchema", () => {
  it("accepts a degraded service with checks", () => {
    const parsed = HealthSchema.parse({
      status: "degraded",
      version: "1.0.0",
      checks: { sandbox: "ok", llmProvider: "degraded" },
    });
    expect(parsed.checks?.llmProvider).toBe("degraded");
  });

  it("rejects an unknown status", () => {
    expect(HealthSchema.safeParse({ status: "down" }).success).toBe(false);
  });
});
