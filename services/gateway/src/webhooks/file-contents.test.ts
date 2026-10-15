import type { ChangedFile } from "@code-sentinel/contracts";
import { captureLogger } from "@code-sentinel/service-kit/testing";
import { describe, expect, it } from "vitest";

import { StubGitHubClient } from "../github/stub-github-client.js";
import { attachFileContents } from "./file-contents.js";

const REF = { installationId: 7, owner: "acme", repo: "api" };
const file = (path: string, changeType: ChangedFile["changeType"] = "modified"): ChangedFile => ({ path, language: "python", changeType, patch: "@@ -1 +1 @@\n-a\n+b\n" });

function setup(texts: Record<string, string>) {
  const github = new StubGitHubClient();
  for (const [path, text] of Object.entries(texts)) github.repoFiles.set(path, { sha: `sha-${path}`, text });
  const { logger, lines } = captureLogger();
  return { github, logger, lines };
}

describe("attachFileContents", () => {
  it("adds each changed file's text at the head commit", async () => {
    const { github, logger } = setup({ "app/a.py": "import os\nb\n", "app/b.py": "b\n" });

    const files = await attachFileContents(github, { ref: REF, headSha: "h1", files: [file("app/a.py"), file("app/b.py")], maxBytes: 1000, logger, requestId: "r1" });

    expect(files.map((f) => f.content)).toEqual(["import os\nb\n", "b\n"]);
  });

  it("leaves deleted, oversized, missing and unreadable files to their diff, and never throws", async () => {
    const { github, logger, lines } = setup({ "big.py": "x".repeat(50), "gone.py": "old\n", "ok.py": "fine\n" });
    github.getFileContent = async (_ref, { path }) => {
      if (path === "broken.py") throw Object.assign(new Error("server error"), { status: 502 });
      const found = github.repoFiles.get(path);
      return found ? { ...found } : undefined;
    };

    const files = await attachFileContents(github, {
      ref: REF,
      headSha: "h1",
      files: [file("gone.py", "deleted"), file("big.py"), file("missing.py"), file("broken.py"), file("ok.py")],
      maxBytes: 20,
      logger,
      requestId: "r1",
    });

    expect(files.map((f) => f.content)).toEqual([undefined, undefined, undefined, undefined, "fine\n"]);
    expect(lines.find((line) => line.message === "changed files read")).toMatchObject({ attached: 1, oversized: 1, failed: 2, outOfTime: 0 });
  });

  it("stops starting new reads once its time budget is spent", async () => {
    const { github, logger, lines } = setup({ "a.py": "a\n" });
    let clock = 0;

    // Every clock read moves 10 s, so the first file is already past the 4 s budget.
    const files = await attachFileContents(github, { ref: REF, headSha: "h1", files: [file("a.py")], maxBytes: 100, logger, requestId: "r1", now: () => (clock += 10_000) });

    expect(files[0]!.content).toBeUndefined();
    expect(lines.find((line) => line.message === "changed files read")).toMatchObject({ attached: 0, outOfTime: 1 });
  });
});
