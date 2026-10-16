import { describe, expect, it } from "vitest";

import type { Finding } from "@code-sentinel/contracts";
import { dedupeKey, FindingAggregator } from "./finding-aggregator.js";
import { severityRank } from "./severity-ranker.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    agent: "security",
    ruleId: "security/hardcoded-secret",
    title: "Hardcoded secret",
    description: "An API key is committed in source.",
    location: { filePath: "src/pay.ts", lineStart: 10, lineEnd: 10 },
    severity: "critical",
    confidence: 0.9,
    ...overrides,
  };
}

describe("FindingAggregator", () => {
  it("collapses two findings that share file, line range and rule", () => {
    const aggregator = new FindingAggregator();

    const result = aggregator.dedupe([
      finding({ agent: "security", confidence: 0.7 }),
      finding({ agent: "logic", confidence: 0.95 }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.confidence).toBe(0.95);
    expect(result[0]?.duplicateCount).toBe(2);
  });

  it("keeps findings that differ in location", () => {
    const aggregator = new FindingAggregator();

    const result = aggregator.dedupe([
      finding({ location: { filePath: "src/pay.ts", lineStart: 10, lineEnd: 10 } }),
      finding({ location: { filePath: "src/pay.ts", lineStart: 42, lineEnd: 42 } }),
    ]);

    expect(result).toHaveLength(2);
  });

  it("keys a finding by file, line range and rule, not by agent or wording", () => {
    const key = dedupeKey(finding());

    expect(key).toMatch(/^[0-9a-f]{40}$/);
    expect(dedupeKey(finding({ agent: "logic", title: "Other", confidence: 0.1 }))).toBe(key);
    expect(dedupeKey(finding({ ruleId: "security/other" }))).not.toBe(key);
  });
});

describe("FindingAggregator.club", () => {
  const sql = (overrides: Partial<Finding> = {}) =>
    finding({ ruleId: "security/sql-concat", title: "SQL built from input", cweId: "CWE-89", location: { filePath: "src/db.py", lineStart: 10, lineEnd: 12 }, ...overrides });

  it("clubs the same CWE family from two agents on overlapping lines, keeping the worst severity and the fix", () => {
    const fix = { kind: "ai_suggested" as const, originalSnippet: "a", suggestedSnippet: "b" };
    const [only, ...rest] = new FindingAggregator().club([
      sql({ severity: "warning", confidence: 0.8, suggestion: fix }),
      sql({ agent: "logic", ruleId: "logic/llm", cweId: "CWE-564", severity: "critical", confidence: 0.95, location: { filePath: "src/db.py", lineStart: 12, lineEnd: 14 } }),
    ]);

    expect(rest).toHaveLength(0);
    expect(only).toMatchObject({ agent: "security", severity: "critical", suggestion: fix, duplicateCount: 2, location: { lineStart: 10, lineEnd: 12 } });
    expect(only?.alsoReportedBy).toEqual([
      { agent: "logic", ruleId: "logic/llm", title: "SQL built from input", description: "An API key is committed in source.", severity: "critical", confidence: 0.95 },
    ]);
  });

  it("keeps different issues, other files, separate lines and the same agent apart", () => {
    const aggregator = new FindingAggregator();
    expect(aggregator.club([sql(), sql({ agent: "logic", cweId: "CWE-79" })])).toHaveLength(2);
    expect(aggregator.club([sql(), sql({ agent: "logic", location: { filePath: "src/other.py", lineStart: 10, lineEnd: 12 } })])).toHaveLength(2);
    expect(aggregator.club([sql(), sql({ agent: "logic", location: { filePath: "src/db.py", lineStart: 13, lineEnd: 20 } })])).toHaveLength(2);
    expect(aggregator.club([sql(), sql({ ruleId: "security/other" })])).toHaveLength(2);
  });

  it("leaves a lone finding untouched", () => {
    expect(new FindingAggregator().club([sql()])[0]).not.toHaveProperty("alsoReportedBy");
  });
});

describe("severityRank", () => {
  it("ranks critical first", () => {
    expect([severityRank("critical"), severityRank("warning"), severityRank("info")]).toEqual([1, 2, 3]);
  });
});
