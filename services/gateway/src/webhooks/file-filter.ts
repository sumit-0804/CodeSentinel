import type { ChangedFile, ChangeType, Language, SkippedFile } from "@code-sentinel/contracts";

import type { PullRequestFile } from "../github/github-client.js";

export interface FilteredFiles {
  files: ChangedFile[];
  skippedFiles: SkippedFile[];
}

const LANGUAGES: Record<string, Language> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  py: "python",
};

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "ico", "pdf", "zip", "gz", "woff", "woff2", "ttf", "eot",
  "mp4", "webp", "svgz", "jar", "class", "exe", "dll", "so", "wasm",
]);

const LOCKFILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "npm-shrinkwrap.json", "poetry.lock",
  "Pipfile.lock", "Cargo.lock", "go.sum", "composer.lock", "Gemfile.lock",
]);

const GENERATED_SUFFIXES = [".min.js", ".min.css", ".map", ".snap"];
const GENERATED_DIRECTORIES = new Set(["node_modules", "vendor", "dist", "build", "__generated__", "generated"]);

const extensionOf = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/** Language from the file extension; anything unrecognised is `unknown` and still reviewed. */
export function languageForPath(path: string): Language {
  return LANGUAGES[extensionOf(path)] ?? "unknown";
}

function isGenerated(path: string): boolean {
  const segments = path.split("/");
  const name = segments.pop() ?? "";
  return (
    LOCKFILES.has(name) ||
    GENERATED_SUFFIXES.some((suffix) => name.endsWith(suffix)) ||
    segments.some((segment) => GENERATED_DIRECTORIES.has(segment))
  );
}

const CHANGE_TYPES: Partial<Record<PullRequestFile["status"], ChangeType>> = {
  added: "added",
  copied: "added",
  modified: "modified",
  changed: "modified",
  renamed: "renamed",
};

/** Maps GitHub PR files to `ChangedFile`s, skipping what no agent can review (`plans/large-diffs.md`). */
export function filterPullRequestFiles(pullRequestFiles: PullRequestFile[]): FilteredFiles {
  const files: ChangedFile[] = [];
  const skippedFiles: SkippedFile[] = [];

  for (const file of pullRequestFiles) {
    const path = file.filename;
    const changeType = CHANGE_TYPES[file.status];
    // Deleted and unchanged files, and pure renames, have nothing to review and are not reported.
    if (!changeType || (changeType === "renamed" && file.patch === undefined)) continue;

    if (isGenerated(path)) {
      skippedFiles.push({ path, reason: "generated_file" });
    } else if (file.patch === undefined) {
      // GitHub omits the patch for binaries and for diffs too large to render.
      skippedFiles.push({ path, reason: BINARY_EXTENSIONS.has(extensionOf(path)) ? "binary" : "too_large" });
    } else {
      files.push({
        path,
        language: languageForPath(path),
        changeType,
        ...(changeType === "renamed" && file.previousFilename ? { previousPath: file.previousFilename } : {}),
        patch: file.patch,
      });
    }
  }

  return { files, skippedFiles };
}
