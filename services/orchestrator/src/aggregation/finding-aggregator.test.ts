import { describe, expect, it } from "vitest";

import type { Finding } from "../types.js";
import { FindingAggregator } from "./finding-aggregator.js";

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
});
