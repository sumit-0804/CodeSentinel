import type { ChangedFile } from "@code-sentinel/contracts";
import { exampleFinding } from "@code-sentinel/contracts/examples";
import { vi } from "vitest";

import type { ReviewAgent } from "./agent.js";

/** A small agent for kit tests: one finding per file on its first added line. */
export function fakeAgent(overrides: Partial<ReviewAgent> = {}): ReviewAgent & { analyze: ReturnType<typeof vi.fn> } {
  const analyze = vi.fn<ReviewAgent["analyze"]>(async (files: ChangedFile[]) => ({
    findings: files.map((file) => ({ ...exampleFinding, location: { filePath: file.path, lineStart: 1, lineEnd: 1 } })),
  }));
  return {
    kind: "security",
    version: "1.2.3",
    languages: ["python", "javascript", "typescript"],
    usesLlm: true,
    maxDiffBytes: 2_000,
    maxFileTokens: 100,
    analyze,
    ...overrides,
  } as ReviewAgent & { analyze: ReturnType<typeof vi.fn> };
}

export const file = (path: string, patch = "@@ -1 +1 @@\n+x = 1", language: ChangedFile["language"] = "python"): ChangedFile => ({
  path,
  language,
  changeType: "modified",
  patch,
});
