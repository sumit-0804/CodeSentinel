import { describe, expect, it } from "vitest";
import type { Finding } from "@code-sentinel/contracts";
import { exactTime, groupByFile, lanesOf, postedCount, timeAgo, verdictOf, verdictSentence } from "./review-view";

const summary = (criticalCount: number) => ({ criticalCount, warningCount: 0, infoCount: 0, autoFixedCount: 0, suggestedFixCount: 0 });

describe("verdictOf", () => {
  it("follows the stored Check Run conclusion", () => {
    expect(verdictOf({ status: "completed", checkConclusion: "fail", summary: summary(0) })).toBe("blocked");
    expect(verdictOf({ status: "completed", checkConclusion: "neutral", summary: summary(2) })).toBe("passed");
    expect(verdictOf({ status: "partial", checkConclusion: "neutral", summary: summary(0) })).toBe("partial");
  });

  it("falls back to any critical finding when no conclusion was stored", () => {
    expect(verdictOf({ status: "completed", summary: summary(1) })).toBe("blocked");
    expect(verdictOf({ status: "completed", summary: summary(0) })).toBe("passed");
  });

  it("shows running and failed reviews as such", () => {
    expect(verdictOf({ status: "queued", summary: summary(0) })).toBe("running");
    expect(verdictOf({ status: "failed", checkConclusion: "fail", summary: summary(3) })).toBe("failed");
  });

  it("says how many critical findings block", () => {
    expect(verdictSentence("blocked", summary(1))).toBe("One critical finding stops this merge.");
    expect(verdictSentence("blocked", summary(2))).toBe("2 critical findings stop this merge.");
    expect(verdictSentence("blocked", summary(0))).toBe("Warnings from an agent set to Block merge stop this merge.");
  });
});

describe("lanesOf", () => {
  it("maps each agent's result to a lane, and shows none for a missing list", () => {
    const results = [
      { agent: "security", result: "critical" },
      { agent: "style", result: "clean" },
      { agent: "performance", result: "not_run" },
      { agent: "logic", result: "running" },
      { agent: "documentation", result: "warning" },
    ] as const;
    expect(lanesOf([...results])).toEqual(["c", "ok", "off", "run", "w"]);
    expect(lanesOf(undefined)).toEqual(["off", "off", "off", "off", "off"]);
  });
});

describe("groupByFile / postedCount / timeAgo", () => {
  const finding = (filePath: string, title: string) => ({ title, location: { filePath, lineStart: 1, lineEnd: 1 } }) as Finding;

  it("groups findings by file in first-seen order", () => {
    const groups = groupByFile([finding("a.py", "1"), finding("b.py", "2"), finding("a.py", "3")]);
    expect(groups.map((g) => [g.path, g.findings.map((f) => f.title)])).toEqual([
      ["a.py", ["1", "3"]],
      ["b.py", ["2"]],
    ]);
  });

  it("counts findings at or above the threshold", () => {
    expect(postedCount([0.95, 0.8, 0.79, 0.5], 0.8)).toBe(2);
    expect(postedCount([0.7], 0.7)).toBe(1);
  });

  it("says how long ago", () => {
    const now = new Date("2026-10-12T12:00:00Z");
    expect(timeAgo("2026-10-12T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-10-12T11:56:00Z", now)).toBe("4 min ago");
    expect(timeAgo("2026-10-12T09:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-10-10T12:00:00Z", now)).toBe("2 days ago");
  });

  it("formats the exact time the same everywhere", () => {
    expect(exactTime("2026-10-12T07:03:16.392Z")).toBe("12 Oct 2026, 07:03 UTC");
  });
});
