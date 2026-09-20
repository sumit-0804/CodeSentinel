import { describe, expect, it } from "vitest";

import type { ChangedFile } from "@code-sentinel/contracts";
import { fileTokens, planLlmReview } from "./plan.js";

/** A file whose patch estimates to exactly `tokens` tokens (3 bytes each). */
function file(path: string, tokens: number, language: ChangedFile["language"] = "python"): ChangedFile {
  return { path, language, changeType: "modified", patch: "x".repeat(tokens * 3) };
}

const LIMITS = { maxFileTokens: 6000, maxBatchTokens: 12000, reviewMaxTokens: 24000 };

describe("planLlmReview", () => {
  it("puts source files first, then smallest first, and packs whole files into batches", () => {
    const plan = planLlmReview(
      [file("big.py", 5000), file("notes.txt", 100, "unknown"), file("small.py", 1000), file("mid.py", 4000), file("b.py", 4000)],
      LIMITS,
    );

    expect(plan.batches.map((batch) => batch.files.map((f) => f.path))).toEqual([
      ["small.py", "mid.py", "b.py"],
      ["big.py", "notes.txt"],
    ]);
    expect(plan.batches.map((batch) => batch.tokens)).toEqual([9000, 5100]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips a file over maxFileTokens as too_large and whatever exceeds the review budget as over_budget", () => {
    const plan = planLlmReview(
      [file("huge.py", 6001), file("a.py", 6000), file("b.py", 6000), file("c.py", 6000), file("d.py", 6000), file("e.py", 10)],
      LIMITS,
    );

    expect(plan.skipped).toEqual([
      { path: "d.py", reason: "over_budget" },
      { path: "huge.py", reason: "too_large" },
    ]);
    expect(plan.batches.flatMap((batch) => batch.files.map((f) => f.path))).toEqual(["e.py", "a.py", "b.py", "c.py"]);
  });

  it("counts gateway context toward a file's tokens", () => {
    expect(fileTokens({ ...file("a.py", 10), contextBefore: "y".repeat(30) })).toBe(20);
  });
});
