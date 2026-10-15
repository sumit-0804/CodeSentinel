import { EXAMPLE_REVIEW_ID } from "@code-sentinel/contracts/examples";
import { LlmProviderError } from "@code-sentinel/llm";
import { noopLogger } from "@code-sentinel/service-kit";
import { describe, expect, it } from "vitest";

import type { AgentContext } from "./agent.js";
import { buildLlmPrompt, LlmPassError, mergeRuleAndLlmFindings, runLlmPass, type LlmFinding, type LlmPassOptions } from "./llm-pass.js";
import { fakeLlm, llmFinding, wholeFile } from "./testing/index.js";

const VIEWS = wholeFile("app/views.py", ["from app.utils import get_user", "", "def show(id):", "    user = get_user(id)", "    return user.name"], [4, 5]);
const OPTIONS: LlmPassOptions = { systemPrompt: "You are the Logic Agent.", task: "Review these changes for bugs.", schemaName: "logic_findings", rulePrefix: "logic/", agentName: "Logic", allowCwe: true };

function context(llm?: ReturnType<typeof fakeLlm>, otherChanges: AgentContext["otherChanges"] = []): AgentContext {
  return {
    reviewId: EXAMPLE_REVIEW_ID,
    requestId: "req-1",
    logger: noopLogger,
    signal: new AbortController().signal,
    deadlineAt: Infinity,
    otherChanges,
    options: {},
    ...(llm ? { llm: { client: llm.client, provider: "groq" as const } } : {}),
  };
}

describe("buildLlmPrompt", () => {
  it("sends the whole file numbered, marks added lines, and lists the other changes as context", () => {
    const prompt = buildLlmPrompt("Task.", [VIEWS], [{ path: "app/utils.py", changeType: "modified", patch: "@@ -1 +1 @@\n-    return user\n+    return None\n" }, { path: "app/big.py", changeType: "added" }]);

    expect(prompt).toContain("### File: app/views.py (python)\n    1   from app.utils import get_user\n");
    expect(prompt).toContain("    4 +     user = get_user(id)\n    5 +     return user.name");
    expect(prompt).toContain("## Other changes in this pull request (context only; do not report on them)");
    expect(prompt).toContain("### app/utils.py (modified)\n@@ -1 +1 @@\n-    return user\n+    return None");
    expect(prompt).toContain("### app/big.py (added; diff not shown)");
  });

  it("falls back to hunks without the whole file, and masks every line", () => {
    const { content: _content, ...hunksOnly } = VIEWS;
    const prompt = buildLlmPrompt("Task.", [hunksOnly], [], (text) => text.replace("name", "****"));

    expect(prompt).toContain("    5 +     return user.****");
    expect(prompt).not.toContain("## Other changes");
  });
});

describe("runLlmPass", () => {
  it("keeps findings on added lines with the agent's prefix, a fix for added lines only, and usage", async () => {
    const llm = fakeLlm({
      findings: [
        llmFinding({ ruleId: "null-dereference", lineStart: 5, lineEnd: 5, cweId: "CWE-476", suggestedCode: "    return user.name if user else None" }),
        llmFinding({ lineStart: 1, title: "On unchanged code" }),
        llmFinding({ filePath: "app/utils.py", lineStart: 2, title: "In another file" }),
      ],
    });

    const result = await runLlmPass([VIEWS], context(llm), OPTIONS);

    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "logic/null-dereference",
        location: { filePath: "app/views.py", lineStart: 5, lineEnd: 5 },
        cweId: "CWE-476",
        suggestion: { kind: "ai_suggested", originalSnippet: "    return user.name", suggestedSnippet: "    return user.name if user else None", explanation: expect.stringContaining("Logic Agent") },
      }),
    ]);
    expect(result.llm).toMatchObject({ provider: "groq", promptTokens: 900 });
    expect(llm.requests[0]!.systemPrompt).toContain("logic/<kebab-case-name>");
  });

  it("leaves the CWE off for agents without CWE mapping", async () => {
    const llm = fakeLlm({ findings: [llmFinding({ lineStart: 4, cweId: "CWE-1050" })] });

    const result = await runLlmPass([VIEWS], context(llm), { ...OPTIONS, allowCwe: false });

    expect(result.findings[0]).not.toHaveProperty("cweId");
  });

  it("returns nothing on failure when optional, but throws LlmPassError when required", async () => {
    const down = () => fakeLlm(new LlmProviderError("boom", { provider: "groq", kind: "http", status: 500 }));

    await expect(runLlmPass([VIEWS], context(down()), OPTIONS)).resolves.toEqual({ findings: [] });
    await expect(runLlmPass([VIEWS], context(down()), { ...OPTIONS, required: true })).rejects.toBeInstanceOf(LlmPassError);
    await expect(runLlmPass([VIEWS], context(fakeLlm("not json")), { ...OPTIONS, required: true })).rejects.toBeInstanceOf(LlmPassError);
    await expect(runLlmPass([VIEWS], context(), { ...OPTIONS, required: true })).rejects.toThrow("no LLM provider");
  });
});

describe("mergeRuleAndLlmFindings", () => {
  const at = (lineStart: number, lineEnd = lineStart, extra: Partial<LlmFinding> = {}): LlmFinding => ({
    ruleId: "logic/x",
    title: "t",
    description: "d",
    location: { filePath: "a.py", lineStart, lineEnd },
    severity: "warning",
    confidence: 0.9,
    ...extra,
  });

  it("drops an LLM duplicate near a rule finding, moving its fix over, and keeps new findings", () => {
    const fix = { kind: "ai_suggested" as const, originalSnippet: "a", suggestedSnippet: "b" };
    const merged = mergeRuleAndLlmFindings([at(10)], [at(9, 11, { suggestion: fix }), at(40)], (f) => f.ruleId);

    expect(merged).toEqual([at(9, 11, { suggestion: fix }), at(40)]);
  });
});
