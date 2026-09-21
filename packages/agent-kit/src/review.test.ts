import { describe, expect, it } from "vitest";

import { EXAMPLE_REVIEW_ID } from "@code-sentinel/contracts/examples";
import { LlmClient, LlmUnavailableError, type LlmProvider } from "@code-sentinel/llm";
import { noopLogger } from "@code-sentinel/service-kit";
import { analyzePerFile, runReview } from "./review.js";
import { fakeAgent, file } from "./test-support.js";

const OPTIONS = { requestId: "req-1", logger: noopLogger };

function groqClient() {
  const groq: LlmProvider = { name: "groq", model: "m", complete: async () => ({ text: "{}", provider: "groq", model: "m", promptTokens: 1, completionTokens: 1 }) };
  return new LlmClient({ groq, maxInputTokens: 1000, maxOutputTokens: 100 });
}

describe("runReview", () => {
  it("skips unsupported languages and oversized files, analyzes the rest, and fills in agent and counts", async () => {
    const agent = fakeAgent();

    const response = await runReview(
      agent,
      {
        reviewId: EXAMPLE_REVIEW_ID,
        files: [file("a.py"), file("notes.md", "@@ -1 +1 @@\n+hi", "unknown"), file("big.py", `@@ -1 +1 @@\n+${"x".repeat(400)}`)],
      },
      OPTIONS,
    );

    expect(agent.analyze.mock.calls[0]?.[0].map((f: { path: string }) => f.path)).toEqual(["a.py"]);
    expect(response).toMatchObject({
      reviewId: EXAMPLE_REVIEW_ID,
      agent: "security",
      serviceVersion: "1.2.3",
      analyzedFileCount: 1,
      skippedFiles: [
        { path: "notes.md", reason: "unsupported_language" },
        { path: "big.py", reason: "too_large" },
      ],
    });
    expect(response.findings).toHaveLength(1);
    expect(response.findings[0]?.agent).toBe("security");
  });

  it("uses the request language for files marked unknown", async () => {
    const agent = fakeAgent();

    await runReview(agent, { reviewId: EXAMPLE_REVIEW_ID, language: "python", files: [file("script", undefined, "unknown")] }, OPTIONS);

    expect(agent.analyze.mock.calls[0]?.[0][0].language).toBe("python");
  });

  it("passes the LLM client and provider only when the orchestrator reserved one", async () => {
    const agent = fakeAgent();
    const llm = groqClient();

    await runReview(agent, { reviewId: EXAMPLE_REVIEW_ID, files: [file("a.py")], options: { llmProvider: "groq", deadlineMs: 5000 } }, { ...OPTIONS, llm });
    await runReview(agent, { reviewId: EXAMPLE_REVIEW_ID, files: [file("a.py")] }, { ...OPTIONS, llm });

    const [withLlm, without] = agent.analyze.mock.calls.map((call: unknown[]) => call[1] as { llm?: { provider: string }; deadlineAt: number });
    expect(withLlm?.llm?.provider).toBe("groq");
    expect(Number.isFinite(withLlm?.deadlineAt)).toBe(true);
    expect(without?.llm).toBeUndefined();
    expect(without?.deadlineAt).toBe(Infinity);
  });

  it("refuses a reserved provider it has no key for", async () => {
    await expect(
      runReview(fakeAgent(), { reviewId: EXAMPLE_REVIEW_ID, files: [file("a.py")], options: { llmProvider: "gemini" } }, { ...OPTIONS, llm: groqClient() }),
    ).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it("merges the agent's own skips and does not count them as analyzed", async () => {
    const agent = fakeAgent({ analyze: async () => ({ findings: [], skipped: [{ path: "b.py", reason: "over_budget" as const }] }) });

    const response = await runReview(agent, { reviewId: EXAMPLE_REVIEW_ID, files: [file("a.py"), file("b.py")] }, OPTIONS);

    expect(response.analyzedFileCount).toBe(1);
    expect(response.skippedFiles).toEqual([{ path: "b.py", reason: "over_budget" }]);
  });

  it("rejects an agent answer that breaks the contract", async () => {
    const broken = fakeAgent({ analyze: async () => ({ findings: [{ ruleId: "x" } as never] }) });

    await expect(runReview(broken, { reviewId: EXAMPLE_REVIEW_ID, files: [file("a.py")] }, OPTIONS)).rejects.toThrow();
  });
});

describe("analyzePerFile", () => {
  it("stops at the deadline and lists the unreached files as over_budget", async () => {
    const controller = new AbortController();

    const { results, skipped } = await analyzePerFile([file("a.py"), file("b.py"), file("c.py")], controller, (f) => {
      if (f.path === "a.py") controller.abort();
      return [f.path];
    });

    expect(results).toEqual(["a.py"]);
    expect(skipped).toEqual([
      { path: "b.py", reason: "over_budget" },
      { path: "c.py", reason: "over_budget" },
    ]);
  });
});
