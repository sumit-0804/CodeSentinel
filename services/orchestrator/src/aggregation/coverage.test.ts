import { describe, expect, it } from "vitest";

import type { ChangedFile } from "@code-sentinel/contracts";
import { buildCoverage, countChangedLines } from "./coverage.js";
import { deriveStatus } from "./index.js";

const file = (path: string, patch: string): ChangedFile => ({ path, language: "python", changeType: "modified", patch });

describe("countChangedLines", () => {
  it("counts added and removed lines but not the file headers or context", () => {
    expect(countChangedLines("--- a/x.py\n+++ b/x.py\n@@ -1,3 +1,3 @@\n keep\n-old\n+new\n+more")).toBe(3);
  });
});

describe("buildCoverage", () => {
  it("counts a file reviewed when any succeeded agent did not skip it", () => {
    const files = [file("a.py", "+1\n+2"), file("big.py", "+1\n+2\n+3"), file("c.py", "-1")];

    const coverage = buildCoverage(
      files,
      [{ path: "logo.png", reason: "binary" }],
      [
        { agent: "security", status: "succeeded" },
        { agent: "style", status: "succeeded" },
        { agent: "logic", status: "timed_out" },
      ],
      [
        { agent: "security", files: [{ path: "big.py", reason: "too_large" }] },
        { agent: "style", files: [{ path: "big.py", reason: "too_large" }, { path: "c.py", reason: "unsupported_language" }] },
      ],
    );

    expect(coverage).toEqual({ filesTotal: 4, filesReviewed: 2, changedLinesTotal: 6, changedLinesReviewed: 3 });
  });
});

describe("deriveStatus with the LLM quota", () => {
  it("is partial when an agent was cut short by llm_quota_exhausted", () => {
    expect(
      deriveStatus([
        { agent: "style", status: "succeeded" },
        { agent: "security", status: "skipped", errorCode: "llm_quota_exhausted" },
      ]),
    ).toBe("partial");
    expect(deriveStatus([{ agent: "security", status: "succeeded", errorCode: "llm_quota_exhausted" }])).toBe("partial");
    expect(
      deriveStatus([
        { agent: "style", status: "succeeded" },
        { agent: "logic", status: "skipped", errorCode: "agent_not_configured" },
      ]),
    ).toBe("completed");
  });
});
