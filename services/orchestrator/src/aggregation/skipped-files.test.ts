import { describe, expect, it } from "vitest";

import { mergeSkippedFiles } from "./skipped-files.js";

describe("mergeSkippedFiles", () => {
  it("returns gateway skips without an agents list", () => {
    expect(
      mergeSkippedFiles([{ path: "package-lock.json", reason: "generated_file" }], []),
    ).toEqual([{ path: "package-lock.json", reason: "generated_file" }]);
  });

  it("returns agent skips with the agent that skipped them", () => {
    expect(
      mergeSkippedFiles([], [{ agent: "logic", files: [{ path: "src/big.ts", reason: "too_large" }] }]),
    ).toEqual([{ path: "src/big.ts", reason: "too_large", agents: ["logic"] }]);
  });

  it("collapses the same path and reason from two agents, listing agents in contract order", () => {
    const merged = mergeSkippedFiles(
      [],
      [
        { agent: "documentation", files: [{ path: "src/big.ts", reason: "too_large" }] },
        { agent: "security", files: [{ path: "src/big.ts", reason: "too_large" }] },
      ],
    );

    expect(merged).toEqual([{ path: "src/big.ts", reason: "too_large", agents: ["security", "documentation"] }]);
  });

  it("keeps the same path with a different reason as a separate entry", () => {
    const merged = mergeSkippedFiles(
      [],
      [
        { agent: "security", files: [{ path: "src/big.ts", reason: "too_large" }] },
        { agent: "logic", files: [{ path: "src/big.ts", reason: "over_budget" }] },
      ],
    );

    expect(merged).toEqual([
      { path: "src/big.ts", reason: "too_large", agents: ["security"] },
      { path: "src/big.ts", reason: "over_budget", agents: ["logic"] },
    ]);
  });

  it("puts gateway entries first, then agent entries by first appearance", () => {
    const merged = mergeSkippedFiles(
      [
        { path: "yarn.lock", reason: "generated_file" },
        { path: "logo.png", reason: "binary" },
      ],
      [
        { agent: "style", files: [{ path: "b.py", reason: "unsupported_language" }] },
        {
          agent: "security",
          files: [
            { path: "a.py", reason: "over_budget" },
            { path: "b.py", reason: "unsupported_language" },
          ],
        },
      ],
    );

    expect(merged).toEqual([
      { path: "yarn.lock", reason: "generated_file" },
      { path: "logo.png", reason: "binary" },
      { path: "b.py", reason: "unsupported_language", agents: ["security", "style"] },
      { path: "a.py", reason: "over_budget", agents: ["security"] },
    ]);
  });
});
