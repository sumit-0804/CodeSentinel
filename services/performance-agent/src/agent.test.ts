import { createAgentService, runReview } from "@code-sentinel/agent-kit";
import { fakeLlm, llmFinding, wholeFile } from "@code-sentinel/agent-kit/testing";
import { AgentReviewResponseSchema, ApiErrorSchema } from "@code-sentinel/contracts";
import { EXAMPLE_REVIEW_ID } from "@code-sentinel/contracts/examples";
import { LlmProviderError } from "@code-sentinel/llm";
import { noopLogger } from "@code-sentinel/service-kit";
import { withServer } from "@code-sentinel/service-kit/testing";
import { describe, expect, it } from "vitest";

import { performanceAgent } from "./agent.js";

// `load_order` queries the database; the added loop (lines 5-6) calls it once per id.
const ORDERS = wholeFile(
  "app/orders.py",
  ["def load_order(db, id):", "    return db.query('SELECT * FROM orders WHERE id = %s', id)", "", "def totals(db, ids):", "    for id in ids:", "        yield load_order(db, id).total"],
  [5, 6],
);

async function review(llm: ReturnType<typeof fakeLlm>, files = [ORDERS]) {
  return runReview(performanceAgent, { reviewId: EXAMPLE_REVIEW_ID, files, options: { llmProvider: "groq" } }, { requestId: "req-1", logger: noopLogger, llm: llm.client });
}

describe("performance agent", () => {
  it("sees the query behind a helper and reports the N+1 on the added loop, without a CWE", async () => {
    const llm = fakeLlm({
      findings: [
        llmFinding({ ruleId: "n-plus-one-query", title: "One query per order", filePath: "app/orders.py", lineStart: 6, lineEnd: 6, cweId: "CWE-1050" }),
        llmFinding({ title: "Old helper", filePath: "app/orders.py", lineStart: 2, lineEnd: 2 }),
      ],
    });

    const response = AgentReviewResponseSchema.parse(await review(llm));

    expect(llm.requests[0]!.prompt).toContain("    2       return db.query(");
    expect(llm.requests[0]!.prompt).toContain("    6 +         yield load_order(db, id).total");
    expect(response.findings).toEqual([
      expect.objectContaining({ agent: "performance", ruleId: "performance/n-plus-one-query", location: { filePath: "app/orders.py", lineStart: 6, lineEnd: 6 } }),
    ]);
    expect(response.findings[0]).not.toHaveProperty("cweId");
  });

  it("asks only about performance and leaves other agents' topics out", async () => {
    const llm = fakeLlm({ findings: [] });

    await review(llm);

    expect(llm.requests[0]!.systemPrompt).toContain("Do not report security vulnerabilities, style, logic bugs or documentation");
    expect(llm.requests[0]!.schemaName).toBe("performance_findings");
  });

  it("fails the run with 503 when the LLM fails", async () => {
    const app = createAgentService({
      agent: performanceAgent,
      serviceToken: "t",
      logger: noopLogger,
      llm: fakeLlm(new LlmProviderError("down", { provider: "groq", kind: "timed_out" })).client,
    });
    let result!: { status: number; body: unknown };
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/review`, {
        method: "POST",
        headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: EXAMPLE_REVIEW_ID, files: [ORDERS], options: { llmProvider: "groq" } }),
      });
      result = { status: response.status, body: await response.json() };
    });

    expect([result.status, ApiErrorSchema.parse(result.body).code]).toEqual([503, "llm_failed"]);
  });
});
