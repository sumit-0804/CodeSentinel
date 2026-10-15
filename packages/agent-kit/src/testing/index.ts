import type { ChangedFile } from "@code-sentinel/contracts";
import { LlmClient, type LlmProvider, type ProviderRequest } from "@code-sentinel/llm";

/** A real `LlmClient` around a fake Groq that answers `answer` (or throws it); `requests` records every call. */
export function fakeLlm(answer: string | Error | { findings: unknown[] }) {
  const requests: ProviderRequest[] = [];
  const groq: LlmProvider = {
    name: "groq",
    model: "openai/gpt-oss-120b",
    async complete(request) {
      requests.push(request);
      if (answer instanceof Error) throw answer;
      return { text: typeof answer === "string" ? answer : JSON.stringify(answer), provider: "groq", model: "openai/gpt-oss-120b", promptTokens: 900, completionTokens: 120 };
    },
  };
  return { client: new LlmClient({ groq, maxInputTokens: 60_000, maxOutputTokens: 500 }), requests };
}

/** One model finding in the shape the LLM pass expects, with every field filled. */
export function llmFinding(overrides: Record<string, unknown> = {}) {
  return {
    ruleId: "x/example",
    title: "Example",
    description: "An example finding.",
    filePath: "app/views.py",
    lineStart: 1,
    lineEnd: 1,
    severity: "warning",
    confidence: 0.9,
    cweId: "",
    suggestedCode: "",
    ...overrides,
  };
}

/**
 * A changed file whose whole text is `lines`, with the 1-based line numbers in `added` marked as
 * added by the pull request (one hunk covering the file).
 */
export function wholeFile(path: string, lines: string[], added: number[], language: ChangedFile["language"] = "python"): ChangedFile {
  const addedSet = new Set(added);
  const oldCount = lines.length - addedSet.size;
  const body = lines.map((text, i) => `${addedSet.has(i + 1) ? "+" : " "}${text}`).join("\n");
  return {
    path,
    language,
    changeType: "modified",
    patch: `@@ -1,${oldCount} +1,${lines.length} @@\n${body}\n`,
    content: `${lines.join("\n")}\n`,
  };
}
