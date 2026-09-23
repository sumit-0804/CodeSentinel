import type { ChangedFile, Language } from "@code-sentinel/contracts";
import { hunkText, parsePatch, type Hunk } from "@code-sentinel/agent-kit";

import type { SandboxFile } from "./sandbox.js";

/** One hunk of one file, written to the sandbox as its own small source file. */
export interface Fragment {
  file: ChangedFile;
  hunk: Hunk;
  /** Common leading whitespace removed so an indented hunk parses as top-level code. */
  indent: string;
  sandboxFile: SandboxFile;
}

const DEFAULT_EXTENSION: Partial<Record<Language, string>> = { python: "py", javascript: "js", typescript: "ts" };
const KNOWN_EXTENSION = /\.(py|js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i;

/**
 * Turns every hunk with added lines into a fragment (FR-STY-01). Agents never see whole files
 * (NFR-06), so each hunk's new side is linted and formatted on its own; the extension picks the
 * linter and formatter inside the sandbox.
 */
export function buildFragments(files: ChangedFile[]): Fragment[] {
  const fragments: Fragment[] = [];
  files.forEach((file, fileIndex) => {
    const extension = KNOWN_EXTENSION.exec(file.path)?.[1]?.toLowerCase() ?? DEFAULT_EXTENSION[file.language];
    if (!extension) return;
    parsePatch(file.patch).hunks.forEach((hunk, hunkIndex) => {
      if (!hunk.lines.some((line) => line.added)) return;
      const indent = commonIndent(hunk.lines.map((line) => line.text));
      const content = hunk.lines.map((line) => line.text.slice(indent.length)).join("\n") + "\n";
      fragments.push({ file, hunk, indent, sandboxFile: { name: `f${fileIndex}_h${hunkIndex}.${extension}`, content } });
    });
  });
  return fragments;
}

/** The fragment's original new-side text, indentation included. */
export function originalText(fragment: Fragment): string {
  return hunkText(fragment.hunk);
}

function commonIndent(lines: string[]): string {
  const indents = lines.filter((line) => line.trim() !== "").map((line) => /^[ \t]*/.exec(line)![0]);
  if (!indents.length) return "";
  return indents.reduce((shortest, indent) => {
    let i = 0;
    while (i < shortest.length && i < indent.length && shortest[i] === indent[i]) i++;
    return shortest.slice(0, i);
  });
}
