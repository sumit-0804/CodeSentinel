import { describe, expect, it } from "vitest";

import { hunkText, parsePatch } from "./patch.js";

describe("parsePatch", () => {
  it("numbers new-side lines from the hunk header and skips removed lines and file headers", () => {
    const patch = [
      "diff --git a/app.py b/app.py",
      "--- a/app.py",
      "+++ b/app.py",
      "@@ -10,4 +10,5 @@ def load():",
      " import os",
      "-old = 1",
      "+new = 1",
      "+extra = 2",
      " done()",
      "",
    ].join("\n");

    const { hunks, addedLines } = parsePatch(patch);

    expect(hunks).toEqual([
      {
        newStart: 10,
        lines: [
          { line: 10, text: "import os", added: false },
          { line: 11, text: "new = 1", added: true },
          { line: 12, text: "extra = 2", added: true },
          { line: 13, text: "done()", added: false },
        ],
      },
    ]);
    expect(addedLines.map((line) => line.line)).toEqual([11, 12]);
    expect(hunkText(hunks[0]!)).toBe("import os\nnew = 1\nextra = 2\ndone()");
  });

  it("handles several hunks, a one-line header without counts, and the no-newline marker", () => {
    const patch = ["@@ -1 +1 @@", "-a", "+b", "\\ No newline at end of file", "@@ -40,2 +41,3 @@", " x", "+y", " z"].join("\n");

    const { hunks, addedLines } = parsePatch(patch);

    expect(hunks.map((hunk) => hunk.newStart)).toEqual([1, 41]);
    expect(addedLines).toEqual([
      { line: 1, text: "b", added: true },
      { line: 42, text: "y", added: true },
    ]);
  });

  it("keeps a blank context line with its space stripped, and CRLF line endings", () => {
    const { hunks } = parsePatch("@@ -1,3 +1,3 @@\r\n a\r\n\r\n+c\r\n");

    expect(hunks[0]?.lines).toEqual([
      { line: 1, text: "a", added: false },
      { line: 2, text: "", added: false },
      { line: 3, text: "c", added: true },
    ]);
  });

  it("returns no added lines for a deletion-only hunk or an empty patch", () => {
    expect(parsePatch("@@ -5,2 +4,0 @@\n-gone\n-too").addedLines).toEqual([]);
    expect(parsePatch("")).toEqual({ hunks: [], addedLines: [] });
  });
});
