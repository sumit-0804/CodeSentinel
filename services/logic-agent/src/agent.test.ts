import { createAgentService, runReview } from "@code-sentinel/agent-kit";
import { fakeLlm, llmFinding, wholeFile } from "@code-sentinel/agent-kit/testing";
import { AgentReviewResponseSchema, ApiErrorSchema } from "@code-sentinel/contracts";
import { EXAMPLE_REVIEW_ID } from "@code-sentinel/contracts/examples";
import { LlmProviderError } from "@code-sentinel/llm";
import { noopLogger } from "@code-sentinel/service-kit";
import { withServer } from "@code-sentinel/service-kit/testing";
import { describe, expect, it } from "vitest";

import { logicAgent } from "./agent.js";

// `get_user` may return None (line 3), and the added line 7 uses it without a check.
const VIEWS = wholeFile(
  "app/views.py",
  ["def get_user(users, id):", "    if id not in users:", "        return None", "    return users[id]", "", "def show(users, id):", "    return get_user(users, id).name"],
  [7],
);

async function review(llm: ReturnType<typeof fakeLlm> | undefined, files = [VIEWS], otherChanges = undefined as undefined | { path: string; changeType: "modified"; patch: string }[]) {
  return runReview(
    logicAgent,
    { reviewId: EXAMPLE_REVIEW_ID, files, ...(otherChanges ? { otherChanges } : {}), options: llm ? { llmProvider: "groq" } : {} },
    { requestId: "req-1", logger: noopLogger, ...(llm ? { llm: llm.client } : {}) },
  );
}

async function post(llm: ReturnType<typeof fakeLlm> | undefined, options: Record<string, unknown>) {
  const app = createAgentService({ agent: logicAgent, serviceToken: "t", logger: noopLogger, ...(llm ? { llm: llm.client } : {}) });
  let result!: { status: number; body: unknown };
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/review`, {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId: EXAMPLE_REVIEW_ID, files: [VIEWS], options }),
    });
    result = { status: response.status, body: await response.json() };
  });
  return result;
}

describe("logic agent", () => {
  it("sends the whole file with the added line marked, and keeps findings on added lines only", async () => {
    const llm = fakeLlm({
      findings: [
        llmFinding({ ruleId: "none-dereference", title: "get_user can return None", lineStart: 7, lineEnd: 7, cweId: "CWE-476", suggestedCode: "    user = get_user(users, id)\n    return user.name if user else None" }),
        llmFinding({ title: "Old code", lineStart: 3, lineEnd: 3 }),
      ],
    });

    const response = AgentReviewResponseSchema.parse(await review(llm));

    expect(llm.requests[0]!.prompt).toContain("    3           return None\n");
    expect(llm.requests[0]!.prompt).toContain("    7 +     return get_user(users, id).name");
    expect(response.findings).toEqual([
      expect.objectContaining({
        agent: "logic",
        ruleId: "logic/none-dereference",
        cweId: "CWE-476",
        location: { filePath: "app/views.py", lineStart: 7, lineEnd: 7 },
        suggestion: expect.objectContaining({ kind: "ai_suggested", originalSnippet: "    return get_user(users, id).name" }),
      }),
    ]);
    expect(response.llm).toMatchObject({ provider: "groq" });
  });

  it("reads the pull request's other changes as context", async () => {
    const llm = fakeLlm({ findings: [] });

    await review(llm, [VIEWS], [{ path: "app/users.py", changeType: "modified", patch: "@@ -4 +4 @@\n-    return users[id]\n+    return users.get(id)\n" }]);

    expect(llm.requests[0]!.prompt).toContain("## Other changes in this pull request");
    expect(llm.requests[0]!.prompt).toContain("+    return users.get(id)");
  });

  it("reads hunks when the gateway sent no whole file", async () => {
    const llm = fakeLlm({ findings: [] });
    const { content: _content, ...hunksOnly } = VIEWS;

    await review(llm, [hunksOnly]);

    expect(llm.requests[0]!.prompt).toContain("    7 +     return get_user(users, id).name");
  });

  it("fails the run with 503 instead of passing clean when the LLM fails or no provider was reserved", async () => {
    const down = fakeLlm(new LlmProviderError("down", { provider: "groq", kind: "http", status: 500 }));

    const failed = await post(down, { llmProvider: "groq" });
    const noProvider = await post(fakeLlm({ findings: [] }), {});
    const noKey = await post(undefined, { llmProvider: "groq" });

    expect([failed.status, ApiErrorSchema.parse(failed.body).code]).toEqual([503, "llm_failed"]);
    expect([noProvider.status, ApiErrorSchema.parse(noProvider.body).code]).toEqual([503, "llm_failed"]);
    expect([noKey.status, ApiErrorSchema.parse(noKey.body).code]).toEqual([503, "llm_unavailable"]);
  });
});
