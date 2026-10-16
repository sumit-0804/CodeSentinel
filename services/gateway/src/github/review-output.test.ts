import { describe, expect, it } from "vitest";

import type { CombinedReport, Finding, ReviewJob } from "@code-sentinel/contracts";
import { checkRunConclusion, checkRunOutput, droppedComments, MAX_REVIEW_COMMENTS, nothingToReviewOutput, postedFixes, reviewComments } from "./review-output.js";

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  agent: "security",
  ruleId: "security/sql-injection",
  title: "SQL built from string formatting",
  description: "Pass values as query parameters.",
  location: { filePath: "app/payments.py", lineStart: 14, lineEnd: 14 },
  severity: "critical",
  confidence: 0.85,
  cweId: "CWE-89",
  ...overrides,
});

function job(findings: Finding[], overrides: Partial<CombinedReport> = {}, status: ReviewJob["status"] = "completed"): ReviewJob {
  return {
    jobId: "0f7e2c1a-9b3d-4e5f-8a6b-1c2d3e4f5a6b",
    reviewId: "8f1c3a92-4c1e-4c22-9a0e-6f2f4b9d0a11",
    status,
    createdAt: "2026-09-27T12:00:00Z",
    report: {
      reviewId: "8f1c3a92-4c1e-4c22-9a0e-6f2f4b9d0a11",
      status: status === "partial" ? "partial" : "completed",
      summary: { criticalCount: 0, warningCount: 0, infoCount: 0, autoFixedCount: 0, suggestedFixCount: 0 },
      findings,
      agentRuns: [
        { agent: "security", status: "succeeded", findingsCount: 3, latencyMs: 1282, llmProvider: "groq" },
        { agent: "style", status: "succeeded", findingsCount: 0, latencyMs: 1706 },
        { agent: "logic", status: "timed_out", errorCode: "agent_timeout", latencyMs: 45000 },
        { agent: "performance", status: "skipped", errorCode: "llm_quota_exhausted" },
        { agent: "documentation", status: "skipped", errorCode: "agent_not_configured" },
      ],
      ...overrides,
    },
  };
}

const styleFix = finding({
  agent: "style",
  ruleId: "style/prettier",
  title: "Formatting differs from prettier",
  description: "prettier reformats these lines.",
  location: { filePath: "web/cart.js", lineStart: 6, lineEnd: 7 },
  severity: "info",
  confidence: 1,
  cweId: undefined,
  suggestion: { kind: "deterministic", originalSnippet: "  var tax  =  0.2\n  if (x) { }", suggestedSnippet: "  var tax = 0.2;\n  if (x) {\n  }" },
});

const BLOCK_SECURITY = ["security"] as const;

describe("checkRunConclusion", () => {
  it("fails on a postable critical finding from a blocking agent, even when the review was partial", () => {
    expect(checkRunConclusion(job([finding()]), 0.8, BLOCK_SECURITY)).toBe("failure");
    expect(checkRunConclusion(job([finding()], {}, "partial"), 0.8, BLOCK_SECURITY)).toBe("failure");
  });

  it("fails on a critical finding from any agent, even one set to comment only", () => {
    expect(checkRunConclusion(job([finding()]), 0.8, [])).toBe("failure");
    expect(checkRunConclusion(job([finding({ agent: "logic" })]), 0.8, BLOCK_SECURITY)).toBe("failure");
  });

  it("blocks on warnings only from agents set to block the merge", () => {
    expect(checkRunConclusion(job([finding({ severity: "warning" })]), 0.8, BLOCK_SECURITY)).toBe("failure");
    expect(checkRunConclusion(job([finding({ agent: "performance", severity: "warning" })]), 0.8, BLOCK_SECURITY)).toBe("success");
  });

  it("is neutral for an incomplete review and success otherwise; low-confidence criticals do not fail it", () => {
    expect(checkRunConclusion(job([finding({ agent: "logic", severity: "warning" })], {}, "partial"), 0.8, BLOCK_SECURITY)).toBe("neutral");
    expect(checkRunConclusion({ ...job([]), status: "failed", report: undefined }, 0.8, BLOCK_SECURITY)).toBe("neutral");
    expect(checkRunConclusion(job([finding({ confidence: 0.5 }), styleFix]), 0.8, BLOCK_SECURITY)).toBe("success");
  });
});

describe("checkRunOutput", () => {
  it("summarises counts, coverage, every agent run, skips and hidden findings, and annotates postable findings", () => {
    const output = checkRunOutput(
      job([finding(), finding({ severity: "warning", confidence: 0.6 }), styleFix], {
        coverage: { filesTotal: 3, filesReviewed: 2, changedLinesTotal: 16, changedLinesReviewed: 16 },
        skippedFiles: [{ path: "logo.png", reason: "binary" }],
      }),
      0.8,
      BLOCK_SECURITY,
      ["2 inline comments could not be placed."],
    );

    expect(output.title).toBe("1 critical · 1 info");
    expect(output.summary).toContain("Merge blocked by **Security**: 1 critical finding.");
    expect(output.summary).toContain("Reviewed 2 of 3 files · 16 of 16 changed lines");
    expect(output.summary).toContain("- ✅ Security — 3 findings via groq (1.3 s)");
    expect(output.summary).toContain("- ⚠️ Logic — no result (timed out) (45.0 s)");
    expect(output.summary).toContain("- ⏸️ Performance — LLM analysis deferred (quota)");
    expect(output.summary).toContain("- ➖ Documentation — not configured");
    expect(output.summary).toContain("- `logo.png` — binary");
    expect(output.summary).toContain("1 lower-confidence finding below the threshold (0.8) not shown.");
    expect(output.summary).toContain("2 inline comments could not be placed.");
    expect(output.annotations).toEqual([
      { path: "app/payments.py", startLine: 14, endLine: 14, level: "failure", title: "Security: SQL built from string formatting (CWE-89)", message: "Pass values as query parameters." },
      { path: "web/cart.js", startLine: 6, endLine: 7, level: "notice", title: "Style: Formatting differs from prettier", message: "prettier reformats these lines." },
    ]);
  });

  it("names every agent whose critical findings, or blocking warnings, stop the merge", () => {
    const output = checkRunOutput(
      job([finding({ agent: "logic" }), finding({ agent: "performance" }), finding({ severity: "warning" }), finding({ agent: "logic", severity: "warning" })]),
      0.8,
      BLOCK_SECURITY,
    );

    expect(output.summary).toContain("Merge blocked by **Security**, **Performance** and **Logic**: 2 critical findings and 1 warning.");
  });

  it("explains a review with no report", () => {
    const output = checkRunOutput(
      { ...job([]), status: "failed", report: undefined, error: { code: "internal_error", message: "The review could not be completed" } },
      0.8,
      BLOCK_SECURITY,
    );

    expect(output).toEqual({ title: "Review did not complete", summary: "The review could not be completed", annotations: [] });
  });

  it("says a cancelled review was superseded, and is neutral even with findings", () => {
    const cancelled = { ...job([finding()]), status: "cancelled" as const };

    expect(checkRunOutput(cancelled, 0.8, BLOCK_SECURITY).title).toBe("Superseded by a newer commit");
    expect(checkRunConclusion(cancelled, 0.8, BLOCK_SECURITY)).toBe("neutral");
  });
});

describe("nothingToReviewOutput", () => {
  it("lists every skipped file with its reason", () => {
    const output = nothingToReviewOutput([
      { path: "package-lock.json", reason: "generated_file" },
      { path: "logo.png", reason: "binary" },
    ]);

    expect(output.title).toBe("Nothing to review");
    expect(output.summary).toContain("- `package-lock.json` — generated or vendored");
    expect(output.summary).toContain("- `logo.png` — binary");
    expect(output.annotations).toEqual([]);
  });

  it("explains a pull request that only removes or renames files", () => {
    expect(nothingToReviewOutput([]).summary).toBe("This pull request only removes or renames files, so there are no changed lines to review.");
  });
});

describe("reviewComments", () => {
  it("posts Security findings inline, with or without a fix, and Style only when it carries a fix", () => {
    const aiFix = finding({
      location: { filePath: "app/payments.py", lineStart: 14, lineEnd: 14 },
      suggestion: { kind: "ai_suggested", originalSnippet: "x", suggestedSnippet: '    cur.execute("SELECT ... = ?", (customer,))' },
    });
    const styleLint = finding({ agent: "style", ruleId: "style/eslint/no-var", severity: "info", confidence: 0.95, cweId: undefined });

    const comments = reviewComments(job([aiFix, finding({ location: { filePath: "app/payments.py", lineStart: 3, lineEnd: 3 } }), styleFix, styleLint]), 0.8);

    expect(comments.map((c) => [c.path, c.startLine, c.line])).toEqual([
      ["app/payments.py", undefined, 14],
      ["app/payments.py", undefined, 3],
      ["web/cart.js", 6, 7],
    ]);
    expect(comments[0]!.body).toBe(
      [
        "**🔴 Critical · Security** — SQL built from string formatting (CWE-89)",
        "",
        "Pass values as query parameters.",
        "",
        "```suggestion",
        '    cur.execute("SELECT ... = ?", (customer,))',
        "```",
        "_AI-suggested fix: review it before committing._",
      ].join("\n"),
    );
    expect(comments[1]!.body).not.toContain("```suggestion");
    expect(comments[2]!.body).toContain("```suggestion\n  var tax = 0.2;\n  if (x) {\n  }\n```\n_Deterministic fix (prettier): safe to apply._");
  });

  it("uses a longer fence when the fix itself contains backticks, and caps the count", () => {
    const fenced = finding({ suggestion: { kind: "ai_suggested", originalSnippet: "x", suggestedSnippet: "const s = ```;" } });
    expect(reviewComments(job([fenced]), 0.8)[0]!.body).toContain("````suggestion\nconst s = ```;\n````");

    const many = Array.from({ length: MAX_REVIEW_COMMENTS + 5 }, (_, i) => finding({ location: { filePath: "a.py", lineStart: i + 1, lineEnd: i + 1 } }));
    expect(reviewComments(job(many), 0.8)).toHaveLength(MAX_REVIEW_COMMENTS);
    expect(droppedComments(job(many), 0.8)).toBe(5);
  });

  it("posts one comment per place with every agent's note, carrying the highest-priority fix on its own lines", () => {
    const styleOnSameLines = finding({ ...styleFix, location: { filePath: "app/payments.py", lineStart: 13, lineEnd: 14 } });
    const securityFix = finding({ suggestion: { kind: "ai_suggested", originalSnippet: "x", suggestedSnippet: "safe()" } });
    const logicNote = finding({ agent: "logic", ruleId: "logic/llm", title: "Customer id is never checked", description: "None reaches the query.", severity: "warning", cweId: undefined, location: { filePath: "app/payments.py", lineStart: 14, lineEnd: 16 } });

    const comments = reviewComments(job([securityFix, logicNote, styleOnSameLines]), 0.8);

    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ path: "app/payments.py", line: 14 });
    expect(comments[0]).not.toHaveProperty("startLine");
    const body = comments[0]!.body;
    expect(body.startsWith("**Flagged by Security, Style and Logic**")).toBe(true);
    expect(body).toContain("**🟠 Warning · Logic** — Customer id is never checked\n\nNone reaches the query.");
    expect(body).toContain("```suggestion\nsafe()\n```\n_AI-suggested fix from Security: review it before committing._");
    expect(body).toContain("_Another fix (Style) is on the Code Sentinel dashboard._");
    expect(postedFixes(job([securityFix, logicNote, styleOnSameLines]), 0.8)).toEqual([securityFix]);
  });

  it("lists a clubbed finding's other agents in its comment and counts places in the Check Run", () => {
    const clubbed = finding({
      duplicateCount: 2,
      alsoReportedBy: [{ agent: "logic", ruleId: "logic/llm", title: "Query built from input", description: "Use parameters.", severity: "critical", confidence: 0.9 }],
    });

    const body = reviewComments(job([clubbed]), 0.8)[0]!.body;
    expect(body).toContain("**Flagged by Security and Logic**");
    expect(body).toContain("**🔴 Critical · Logic** — Query built from input");

    const output = checkRunOutput(job([clubbed, finding({ agent: "logic", ruleId: "logic/x", cweId: undefined })]), 0.8, BLOCK_SECURITY);
    expect(output.summary).toContain("2 findings in 1 place.");
  });
});

describe("clubbed findings and merge blocking", () => {
  it("blocks on a clubbed warning when any of its agents is set to block the merge", () => {
    const warning = finding({
      agent: "performance",
      severity: "warning",
      alsoReportedBy: [{ agent: "security", ruleId: "security/x", title: "t", description: "d", severity: "warning", confidence: 0.9 }],
    });

    expect(checkRunConclusion(job([warning]), 0.8, BLOCK_SECURITY)).toBe("failure");
    expect(checkRunConclusion(job([warning]), 0.8, [])).toBe("success");
    expect(checkRunOutput(job([warning]), 0.8, BLOCK_SECURITY).summary).toContain("Merge blocked by **Security** and **Performance**: 1 warning.");
  });
});
