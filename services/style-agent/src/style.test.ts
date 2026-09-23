import { describe, expect, it, vi } from "vitest";

import { runReview } from "@code-sentinel/agent-kit";
import type { ChangedFile } from "@code-sentinel/contracts";
import { EXAMPLE_REVIEW_ID } from "@code-sentinel/contracts/examples";
import { HttpError, noopLogger } from "@code-sentinel/service-kit";
import { createStyleAgent } from "./agent.js";
import { changedBlocks, fragmentFindings } from "./findings.js";
import { buildFragments } from "./fragments.js";
import type { Sandbox, SandboxResult } from "./sandbox.js";

const file = (path: string, patch: string, language: ChangedFile["language"] = "typescript"): ChangedFile => ({
  path,
  language,
  changeType: "modified",
  patch,
});

describe("buildFragments", () => {
  it("writes one dedented fragment per hunk with added lines, named by file and hunk", () => {
    const fragments = buildFragments([
      file("src/a.tsx", "@@ -10,2 +10,3 @@\n     if (x) {\n+      run( x )\n     }\n@@ -40,1 +41,0 @@\n-gone"),
      file("tool.py", "@@ -1 +1 @@\n+x=1", "python"),
      file("README.md", "@@ -1 +1 @@\n+hi", "unknown"),
    ]);

    expect(fragments.map((f) => [f.sandboxFile.name, f.indent, f.sandboxFile.content])).toEqual([
      ["f0_h0.tsx", "    ", "if (x) {\n  run( x )\n}\n"],
      ["f1_h0.py", "", "x=1\n"],
    ]);
  });
});

describe("fragmentFindings", () => {
  const [fragment] = buildFragments([file("src/a.ts", "@@ -10,3 +10,3 @@\n   const a = 1\n+  var b =  2\n+  let c=3\n")]);

  it("keeps diagnostics on added lines only and maps them to real line numbers", () => {
    const findings = fragmentFindings(fragment!, {
      diagnostics: [
        { line: 1, column: 1, ruleId: "eslint/prefer-const", message: "context line", fixable: true },
        { line: 2, column: 1, ruleId: "eslint/no-var", message: "Unexpected var, use let or const instead.", fixable: true },
        { line: 2, column: 1, ruleId: "eslint/no-var", message: "duplicate", fixable: true },
      ],
    });

    expect(findings).toEqual([
      {
        ruleId: "style/eslint/no-var",
        title: "Unexpected var, use let or const instead.",
        description: "eslint/no-var: Unexpected var, use let or const instead. (auto-fixable with the linter's --fix)",
        location: { filePath: "src/a.ts", lineStart: 11, lineEnd: 11 },
        severity: "info",
        confidence: 0.95,
      },
    ]);
  });

  it("turns same-length formatter output into a deterministic fix of the changed added lines, re-indented", () => {
    const findings = fragmentFindings(fragment!, { diagnostics: [], formatted: "const a = 1;\nvar b = 2;\nlet c = 3;\n" });

    // Line 10 is context: its missing semicolon is not ours to fix.
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "style/prettier",
        location: { filePath: "src/a.ts", lineStart: 11, lineEnd: 12 },
        suggestion: {
          kind: "deterministic",
          originalSnippet: "  var b =  2\n  let c=3",
          suggestedSnippet: "  var b = 2;\n  let c = 3;",
          explanation: "Formatted with prettier.",
        },
      }),
    ]);
  });

  it("fixes added lines the formatter split or joined, including inserted blank lines", () => {
    const [py] = buildFragments([file("tool.py", "@@ -0,0 +1,2 @@\n+import os\n+def f( a ):  return a", "python")]);
    const [cart] = buildFragments([
      file("web/cart.js", "@@ -20,2 +20,4 @@\n   let sum = 0\n+  var tax  =  0.2\n+  if (sum == null) { }\n   return sum", "javascript"),
    ]);

    const black = fragmentFindings(py!, { diagnostics: [], formatted: "import os\n\n\ndef f(a):\n    return a\n" });
    const prettier = fragmentFindings(cart!, { diagnostics: [], formatted: "let sum = 0;\nvar tax = 0.2;\nif (sum == null) {\n}\nreturn sum;\n" });

    expect(black).toEqual([
      expect.objectContaining({
        ruleId: "style/black",
        // "import os" is unchanged, so only line 2 is fixed; black's blank lines come first.
        location: { filePath: "tool.py", lineStart: 2, lineEnd: 2 },
        suggestion: expect.objectContaining({ originalSnippet: "def f( a ):  return a", suggestedSnippet: "\n\ndef f(a):\n    return a" }),
      }),
    ]);
    // Context lines 20 and 23 also gain a semicolon, but they are not this PR's code.
    expect(prettier).toEqual([
      expect.objectContaining({
        location: { filePath: "web/cart.js", lineStart: 21, lineEnd: 22 },
        suggestion: expect.objectContaining({
          originalSnippet: "  var tax  =  0.2\n  if (sum == null) { }",
          suggestedSnippet: "  var tax = 0.2;\n  if (sum == null) {\n  }",
        }),
      }),
    ]);
  });

  it("offers no fix for new code joined into unchanged code, and nothing for an unparsed fragment", () => {
    const joined = fragmentFindings(fragment!, { diagnostics: [], formatted: "const a = 1; var b = 2;\nlet c = 3;\n" });

    // Line 11 was joined into context line 10: flagged, no fix. Line 12 still gets its own fix.
    expect(joined.map((f) => [f.location.lineStart, f.suggestion?.suggestedSnippet])).toEqual([
      [12, "  let c = 3;"],
      [11, undefined],
    ]);
    expect(fragmentFindings(fragment!, { diagnostics: [{ line: 2, column: 1, ruleId: "x", message: "y", fixable: false }], parseError: "bad" })).toEqual([]);
    expect(fragmentFindings(fragment!, { diagnostics: [], formatted: "const a = 1\nvar b =  2\nlet c=3\n" })).toEqual([]);
  });
});

describe("changedBlocks", () => {
  it("pairs reformatted lines one to one and keeps split lines together", () => {
    expect(changedBlocks(["a = 1", "b  =  2", "keep", "if (x) { }"], ["a = 1;", "b = 2;", "keep", "if (x) {", "}"])).toEqual([
      { aStart: 0, aEnd: 1, bStart: 0, bEnd: 1 },
      { aStart: 1, aEnd: 2, bStart: 1, bEnd: 2 },
      { aStart: 3, aEnd: 4, bStart: 3, bEnd: 5 },
    ]);
  });

  it("attaches a pure insertion to the line before, or after at the start", () => {
    expect(changedBlocks(["import os", "x = 1"], ["import os", "", "x = 1"])).toEqual([{ aStart: 0, aEnd: 1, bStart: 0, bEnd: 2 }]);
    expect(changedBlocks(["x = 1"], ["", "x = 1"])).toEqual([{ aStart: 0, aEnd: 1, bStart: 0, bEnd: 2 }]);
  });
});

describe("style agent", () => {
  const FILES = [file("src/a.ts", "@@ -1 +1 @@\n+var b =  2")];
  const request = { reviewId: EXAMPLE_REVIEW_ID, files: FILES };
  const options = { requestId: "req-1", logger: noopLogger };

  function sandbox(result: SandboxResult | Error): Sandbox & { run: ReturnType<typeof vi.fn> } {
    return {
      run: vi.fn(async () => {
        if (result instanceof Error) throw result;
        return result;
      }),
      health: async () => "ok",
    };
  }

  it("runs one sandbox call per request and never reports an LLM", async () => {
    const fake = sandbox({ files: { "f0_h0.ts": { diagnostics: [{ line: 1, column: 1, ruleId: "eslint/no-var", message: "m", fixable: true }], formatted: "var b = 2;\n" } } });

    const response = await runReview(createStyleAgent(fake), request, options);

    expect(fake.run).toHaveBeenCalledTimes(1);
    expect(response.findings.map((f) => f.ruleId)).toEqual(["style/eslint/no-var", "style/prettier"]);
    expect(response.findings[1]?.suggestion?.kind).toBe("deterministic");
    expect(response).not.toHaveProperty("llm");
  });

  it("marks every file over_budget when the sandbox is stopped at the deadline", async () => {
    const stopped = sandbox(Object.assign(new Error("timed out"), { name: "TimeoutError" }));

    const response = await runReview(createStyleAgent(stopped), request, options);

    expect(response.skippedFiles).toEqual([{ path: "src/a.ts", reason: "over_budget" }]);
    expect(response.analyzedFileCount).toBe(0);
  });

  it("answers 503 sandbox_unavailable when Docker fails, and reports sandbox health", async () => {
    const agent = createStyleAgent(sandbox(new Error("Cannot connect to the Docker daemon")));

    await expect(runReview(agent, request, options)).rejects.toSatisfy((error) => error instanceof HttpError && error.code === "sandbox_unavailable");
    expect(await agent.health?.()).toEqual({ sandbox: "ok" });
  });
});
