import { describe, expect, it, vi } from "vitest";

import { runReview } from "@code-sentinel/agent-kit";
import type { ChangedFile } from "@code-sentinel/contracts";
import { EXAMPLE_REVIEW_ID } from "@code-sentinel/contracts/examples";
import { LlmClient, LlmProviderError, type LlmProvider, type ProviderRequest } from "@code-sentinel/llm";
import { noopLogger } from "@code-sentinel/service-kit";
import { captureLogger } from "@code-sentinel/service-kit/testing";
import { securityAgent } from "./agent.js";
import { buildPrompt } from "./llm-pass.js";

const FILE: ChangedFile = {
  path: "payments/retry_queue.py",
  language: "python",
  changeType: "modified",
  patch: [
    "@@ -128,2 +128,5 @@",
    "     conn = connect(DSN)",
    '+    cur.execute(f"SELECT * FROM payments WHERE id = {payment_id}")',
    "+    token = 'AKIAIOSFODNN7EXAMPLE'",
    "+    url = request.args['next']",
    "     return cur",
  ].join("\n"),
};

function llmAnswering(text: string | Error) {
  const complete = vi.fn<LlmProvider["complete"]>(async (_request: ProviderRequest) => {
    if (text instanceof Error) throw text;
    return { text, provider: "groq", model: "openai/gpt-oss-120b", promptTokens: 900, completionTokens: 120 };
  });
  return { client: new LlmClient({ groq: { name: "groq", model: "openai/gpt-oss-120b", complete }, maxInputTokens: 20_000, maxOutputTokens: 500 }), complete };
}

const finding = (overrides: Record<string, unknown>) => ({
  ruleId: "security/open-redirect",
  title: "Open redirect",
  description: "The next parameter is used as a redirect target.",
  filePath: FILE.path,
  lineStart: 131,
  lineEnd: 131,
  severity: "warning",
  confidence: 0.8,
  cweId: "CWE-601",
  ...overrides,
});

async function review(llm?: LlmClient, logger = noopLogger) {
  return runReview(
    securityAgent,
    { reviewId: EXAMPLE_REVIEW_ID, files: [FILE], options: llm ? { llmProvider: "groq", deadlineMs: 30_000 } : {} },
    { requestId: "req-1", logger, ...(llm ? { llm } : {}) },
  );
}

describe("security agent", () => {
  it("returns rule findings without an LLM call when no provider was reserved", async () => {
    const response = await review();

    expect(response.findings.map((f) => [f.ruleId, f.location.lineStart])).toEqual([
      ["security/sql-injection", 129],
      ["security/secret-aws-access-key", 130],
    ]);
    expect(response).not.toHaveProperty("llm");
  });

  it("adds valid LLM findings on added lines, drops the rest, skips duplicates and reports usage", async () => {
    const { client } = llmAnswering(
      JSON.stringify({
        findings: [
          finding({}),
          finding({ ruleId: "sql-injection-again", lineStart: 129, lineEnd: 129, cweId: "CWE-89" }),
          // Same issue, but the model put it on the line before (seen live with Gemini).
          finding({ ruleId: "sql-injection-drifted", lineStart: 130, lineEnd: 130, cweId: "CWE-89" }),
          finding({ ruleId: "security/old-code", lineStart: 128, lineEnd: 128 }),
          finding({ ruleId: "security/elsewhere", filePath: "other.py" }),
          finding({ ruleId: "raw-id", lineStart: 131, lineEnd: 999, confidence: 3, cweId: "not-a-cwe" }),
        ],
      }),
    );

    const response = await review(client);

    const llmFindings = response.findings.slice(2);
    expect(llmFindings.map((f) => f.ruleId)).toEqual(["security/open-redirect", "security/raw-id"]);
    expect(llmFindings[1]).toMatchObject({ location: { lineStart: 131, lineEnd: 151 }, confidence: 1 });
    expect(llmFindings[1]).not.toHaveProperty("cweId");
    expect(response.llm).toEqual({ provider: "groq", model: "openai/gpt-oss-120b", fallbackDepth: 0, promptTokens: 900, completionTokens: 120 });
  });

  it("keeps rule findings when the LLM fails or answers junk, and logs why", async () => {
    const { logger, lines } = captureLogger();

    const failed = await review(llmAnswering(new LlmProviderError("down", { provider: "groq", kind: "http", status: 400 })).client, logger);
    const junk = await review(llmAnswering("not json").client, logger);

    expect(failed.findings).toHaveLength(2);
    expect(failed).not.toHaveProperty("llm");
    expect(junk.findings).toHaveLength(2);
    expect(junk.llm?.promptTokens).toBe(900);
    expect(lines.map((line) => line.message)).toEqual([
      "llm pass failed; returning rule findings only",
      "llm answer did not match the schema; ignored",
    ]);
  });

  it("sends numbered hunks with secrets masked, never the raw secret", async () => {
    const { client, complete } = llmAnswering('{"findings":[]}');

    await review(client);

    const prompt = complete.mock.calls[0]?.[0].prompt ?? "";
    expect(prompt).toContain("  129 +     cur.execute(");
    expect(prompt).toContain("  128       conn = connect(DSN)");
    expect(prompt).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(prompt).toContain("AKIA****");
    expect(buildPrompt([FILE])).toBe(prompt);
  });
});
