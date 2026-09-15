import { describe, expect, it } from "vitest";

import type { PullRequestFile } from "../github/github-client.js";
import { filterPullRequestFiles, languageForPath } from "./file-filter.js";

const PATCH = "@@ -1 +1 @@\n-a\n+b\n";
const modified = (filename: string): PullRequestFile => ({ filename, status: "modified", patch: PATCH });

describe("filterPullRequestFiles", () => {
  it("maps .ts, .tsx, .mjs and .py to their languages", () => {
    expect(["a.ts", "b.tsx", "c.mjs", "d.py"].map(languageForPath)).toEqual([
      "typescript",
      "typescript",
      "javascript",
      "python",
    ]);
    expect(filterPullRequestFiles([modified("src/app.ts")]).files).toEqual([
      { path: "src/app.ts", language: "typescript", changeType: "modified", patch: PATCH },
    ]);
  });

  it("keeps a .md file with language unknown", () => {
    expect(filterPullRequestFiles([modified("README.md")]).files).toEqual([
      { path: "README.md", language: "unknown", changeType: "modified", patch: PATCH },
    ]);
  });

  it("drops removed files silently", () => {
    expect(filterPullRequestFiles([{ filename: "old.ts", status: "removed", patch: PATCH }])).toEqual({
      files: [],
      skippedFiles: [],
    });
  });

  it("drops a pure rename and keeps a rename with changes as renamed", () => {
    const result = filterPullRequestFiles([
      { filename: "moved.ts", status: "renamed", previousFilename: "original.ts" },
      { filename: "edited.ts", status: "renamed", previousFilename: "before.ts", patch: PATCH },
    ]);

    expect(result.skippedFiles).toEqual([]);
    expect(result.files).toEqual([
      { path: "edited.ts", language: "typescript", changeType: "renamed", previousPath: "before.ts", patch: PATCH },
    ]);
  });

  it("skips a binary file without a patch as binary", () => {
    expect(filterPullRequestFiles([{ filename: "assets/logo.png", status: "added" }]).skippedFiles).toEqual([
      { path: "assets/logo.png", reason: "binary" },
    ]);
  });

  it("skips a source file without a patch as too_large", () => {
    expect(filterPullRequestFiles([{ filename: "big.ts", status: "modified" }]).skippedFiles).toEqual([
      { path: "big.ts", reason: "too_large" },
    ]);
  });

  it("skips lockfiles, build output and minified files as generated_file", () => {
    const result = filterPullRequestFiles([modified("package-lock.json"), modified("dist/app.js"), modified("public/app.min.js")]);

    expect(result.files).toEqual([]);
    expect(result.skippedFiles).toEqual([
      { path: "package-lock.json", reason: "generated_file" },
      { path: "dist/app.js", reason: "generated_file" },
      { path: "public/app.min.js", reason: "generated_file" },
    ]);
  });

  it("keeps GitHub's order in both lists", () => {
    const result = filterPullRequestFiles([
      modified("z.py"),
      modified("yarn.lock"),
      { filename: "added.js", status: "added", patch: PATCH },
      { filename: "font.woff2", status: "added" },
      { filename: "copy.ts", status: "copied", patch: PATCH },
    ]);

    expect(result.files.map((f) => [f.path, f.changeType])).toEqual([
      ["z.py", "modified"],
      ["added.js", "added"],
      ["copy.ts", "added"],
    ]);
    expect(result.skippedFiles.map((f) => f.path)).toEqual(["yarn.lock", "font.woff2"]);
  });

  it("returns no files when every file is skipped", () => {
    const result = filterPullRequestFiles([modified("package-lock.json"), { filename: "logo.png", status: "added" }]);

    expect(result.files).toEqual([]);
    expect(result.skippedFiles).toHaveLength(2);
  });
});
