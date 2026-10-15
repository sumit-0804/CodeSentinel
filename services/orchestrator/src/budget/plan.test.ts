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

  it("counts the whole file toward a file's tokens", () => {
    expect(fileTokens({ ...file("a.py", 10), content: "y".repeat(30) })).toBe(20);
  });

  it("puts files linked by imports into one batch, even when an unrelated smaller file would fit first", () => {
    const views = { ...file("app/views.py", 10), content: "from app.utils import get_user\n" + "y".repeat(5000 * 3) };
    const utils = { ...file("app/utils.py", 10), content: "y".repeat(3000 * 3) };

    const plan = planLlmReview([views, file("app/other.py", 2000), utils], { ...LIMITS, maxFileTokens: 12000, maxBatchTokens: 9000 });

    expect(plan.batches.map((batch) => batch.files.map((f) => f.path))).toEqual([["app/other.py"], ["app/views.py", "app/utils.py"]]);
  });

  it("reviews a whole file over maxFileTokens from its diff, and shrinks a linked group to fit one call", () => {
    const big = { ...file("svc/big.ts", 100, "typescript"), content: "x".repeat(20000 * 3) };
    const a = { ...file("svc/a.ts", 100, "typescript"), content: 'import { b } from "./b";\n' + "x".repeat(5000 * 3) };
    const b = { ...file("svc/b.ts", 100, "typescript"), content: "x".repeat(4000 * 3) };

    const plan = planLlmReview([big, a, b], { maxFileTokens: 12000, maxBatchTokens: 7000, reviewMaxTokens: 80000 });

    const sent = plan.batches.flatMap((batch) => batch.files);
    expect(sent.find((f) => f.path === "svc/big.ts")?.content).toBeUndefined();
    // a + b whole is ~9100 tokens, so the larger (a) goes as its diff and both still share a call.
    const shared = plan.batches.find((batch) => batch.files.some((f) => f.path === "svc/a.ts"))!;
    expect(shared.files.filter((f) => f.path !== "svc/big.ts").map((f) => [f.path, f.content !== undefined])).toEqual([
      ["svc/a.ts", false],
      ["svc/b.ts", true],
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("gives every batch the rest of the pull request's diffs, linked files first, then paths past the budget", () => {
    const files = [file("a.py", 5000), file("b.py", 5000), { ...file("c.py", 300), patch: "+c\n".repeat(300) }, file("d.py", 300)];

    const plan = planLlmReview(files, { maxFileTokens: 6000, maxBatchTokens: 6000, reviewMaxTokens: 80000, otherChangesTokens: 600 });

    const first = plan.batches[0]!;
    expect(first.files.map((f) => f.path)).toEqual(["c.py", "d.py", "a.py"].slice(0, first.files.length));
    for (const batch of plan.batches) {
      const inBatch = new Set(batch.files.map((f) => f.path));
      expect(batch.otherChanges.map((c) => c.path).sort()).toEqual(files.map((f) => f.path).filter((p) => !inBatch.has(p)).sort());
      expect(batch.otherTokens).toBeLessThanOrEqual(600 + 20);
    }
    const last = plan.batches.at(-1)!;
    expect(last.otherChanges.filter((c) => c.patch !== undefined).length).toBeGreaterThan(0);
    expect(last.otherChanges.some((c) => c.patch === undefined)).toBe(true);
  });
});
