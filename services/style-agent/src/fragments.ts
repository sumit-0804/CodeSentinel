import type { ChangedFile, Language } from "@code-sentinel/contracts";
import { hunkText, parsePatch, type Hunk } from "@code-sentinel/agent-kit";

import type { SandboxFile } from "./sandbox.js";

/** One hunk of one file, written to the sandbox as its own small source file. */
export interface Fragment {
  file: ChangedFile;
  hunk: Hunk;
  /** Common leading whitespace removed so an indented hunk parses as top-level code. */
  indent: string;
  /** Wrapper lines added before the hunk so its unmatched `}` lines parse (JS/TS). */
  prefixLines: number;
  /** Closing `}` lines added after the hunk for its unclosed `{`. */
  suffixLines: number;
  sandboxFile: SandboxFile;
}

/** The line that opens a wrapper around a hunk that starts inside a block. */
export const WRAPPER_OPEN = "function __cs_wrap__() {";

const DEFAULT_EXTENSION: Partial<Record<Language, string>> = { python: "py", javascript: "js", typescript: "ts" };
const KNOWN_EXTENSION = /\.(py|js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i;

/**
 * What the sandbox lints and formats (FR-STY-01); the extension picks the tools. A file the gateway
 * sent whole is one fragment covering every line, with this PR's lines marked added, so it parses
 * as it really is. Otherwise each hunk with added lines is a fragment of its own, dedented and
 * wrapped so it parses alone.
 */
export function buildFragments(files: ChangedFile[]): Fragment[] {
  const fragments: Fragment[] = [];
  files.forEach((file, fileIndex) => {
    const extension = KNOWN_EXTENSION.exec(file.path)?.[1]?.toLowerCase() ?? DEFAULT_EXTENSION[file.language];
    if (!extension) return;
    const parsed = parsePatch(file.patch);
    if (file.content !== undefined) {
      if (!parsed.addedLines.length) return;
      const added = new Set(parsed.addedLines.map((line) => line.line));
      const text = file.content.replace(/\r\n/g, "\n").replace(/\n$/, "");
      const hunk: Hunk = { newStart: 1, lines: text.split("\n").map((line, i) => ({ line: i + 1, text: line, added: added.has(i + 1) })) };
      fragments.push({ file, hunk, indent: "", prefixLines: 0, suffixLines: 0, sandboxFile: { name: `f${fileIndex}.${extension}`, content: `${text}\n` } });
      return;
    }
    parsed.hunks.forEach((hunk, hunkIndex) => {
      if (!hunk.lines.some((line) => line.added)) return;
      const indent = commonIndent(hunk.lines.map((line) => line.text));
      const body = hunk.lines.map((line) => line.text.slice(indent.length));
      // A real hunk usually starts inside a function: wrap it so its braces balance and it parses.
      const { unmatchedClose, unclosed } = extension === "py" ? { unmatchedClose: 0, unclosed: 0 } : braceBalance(body.join("\n"));
      const lines = [...Array<string>(unmatchedClose).fill(WRAPPER_OPEN), ...body, ...Array<string>(unclosed).fill("}")];
      fragments.push({
        file,
        hunk,
        indent,
        prefixLines: unmatchedClose,
        suffixLines: unclosed,
        sandboxFile: { name: `f${fileIndex}_h${hunkIndex}.${extension}`, content: lines.join("\n") + "\n" },
      });
    });
  });
  return fragments;
}

/** The fragment's original new-side text, indentation included. */
export function originalText(fragment: Fragment): string {
  return hunkText(fragment.hunk);
}

/**
 * Unmatched `}` (a hunk that starts inside a block) and unclosed `{` (one that ends inside one),
 * ignoring braces in strings, template literals and comments.
 */
export function braceBalance(code: string): { unmatchedClose: number; unclosed: number } {
  let depth = 0;
  let lowest = 0;
  for (let i = 0; i < code.length; i++) {
    const char = code[i]!;
    const next = code[i + 1];
    if (char === "/" && next === "/") {
      i = code.indexOf("\n", i);
      if (i === -1) break;
    } else if (char === "/" && next === "*") {
      i = code.indexOf("*/", i + 2);
      if (i === -1) break;
      i++;
    } else if (char === '"' || char === "'" || char === "`") {
      for (i++; i < code.length && code[i] !== char; i++) {
        if (code[i] === "\\") i++;
        // A plain string ends at the line; a template literal may span lines.
        else if (code[i] === "\n" && char !== "`") break;
      }
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      lowest = Math.min(lowest, depth);
    }
  }
  return { unmatchedClose: Math.abs(lowest), unclosed: depth - lowest };
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
