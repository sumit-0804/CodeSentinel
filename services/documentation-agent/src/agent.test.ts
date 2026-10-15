import { runReview } from "@code-sentinel/agent-kit";
import { fakeLlm, llmFinding, wholeFile } from "@code-sentinel/agent-kit/testing";
import { AgentReviewResponseSchema } from "@code-sentinel/contracts";
import { EXAMPLE_REVIEW_ID } from "@code-sentinel/contracts/examples";
import { LlmProviderError } from "@code-sentinel/llm";
import { noopLogger } from "@code-sentinel/service-kit";
import { describe, expect, it } from "vitest";

import { documentationAgent } from "./agent.js";

const API = wholeFile(
  "src/api.ts",
  ["import { db } from \"./db\";", "", "export function total(ids: string[]): number {", "  return ids.length;", "}"],
  [3, 4, 5],
  "typescript",
);

async function review(llm: ReturnType<typeof fakeLlm>) {
  return runReview(documentationAgent, { reviewId: EXAMPLE_REVIEW_ID, files: [API], options: { llmProvider: "groq" } }, { requestId: "req-1", logger: noopLogger, llm: llm.client });
}

describe("documentation agent", () => {
  it("suggests a JSDoc block placed before the added signature, always as info", async () => {
    const llm = fakeLlm({
      findings: [
        llmFinding({
          ruleId: "documentation/missing-docstring",
          title: "total has no JSDoc",
          filePath: "src/api.ts",
          lineStart: 3,
          lineEnd: 3,
          severity: "warning",
          suggestedCode: "/**\n * Counts the ids.\n * @param ids The order ids.\n * @returns How many ids there are.\n */\nexport function total(ids: string[]): number {",
        }),
      ],
    });

    const response = AgentReviewResponseSchema.parse(await review(llm));

    expect(response.findings).toEqual([
      expect.objectContaining({
        agent: "documentation",
        ruleId: "documentation/missing-docstring",
        severity: "info",
        suggestion: expect.objectContaining({
          originalSnippet: "export function total(ids: string[]): number {",
          suggestedSnippet: expect.stringMatching(/^\/\*\*\n[\s\S]*@returns[\s\S]*\*\/\nexport function total/),
        }),
      }),
    ]);
  });

  it("drops findings outside its two rules", async () => {
    const llm = fakeLlm({ findings: [llmFinding({ ruleId: "documentation/naming", filePath: "src/api.ts", lineStart: 4, lineEnd: 4 })] });

    const response = await review(llm);

    expect(response.findings).toEqual([]);
  });

  it("only asks about public symbols and fails the run when the LLM fails", async () => {
    const llm = fakeLlm({ findings: [] });
    await review(llm);
    expect(llm.requests[0]!.systemPrompt).toContain('whose name does not start with "_"');

    await expect(review(fakeLlm(new LlmProviderError("down", { provider: "groq", kind: "network" })))).rejects.toThrow("llm pass failed");
  });
});
