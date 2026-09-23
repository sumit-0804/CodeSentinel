import type { AnalysisResult } from "@code-sentinel/agent-kit";
import type { Severity } from "@code-sentinel/contracts";

import type { Fragment } from "./fragments.js";
import type { SandboxFileResult } from "./sandbox.js";

export type StyleFinding = AnalysisResult["findings"][number];

/** Diagnostics that point at likely bugs rather than taste; everything else is `info`. */
const WARNING_RULE = /^(?:ruff\/[FB]\d|eslint\/(?:no-dupe|no-self|no-cond-assign|no-constant|no-unsafe|use-isnan|valid-typeof))/;

/**
 * Maps one fragment's sandbox result back to the pull request: diagnostics on added lines become
 * findings (FR-STY-04), and formatter output becomes deterministic fixes (FR-STY-03). A fragment
 * that did not parse on its own produces nothing.
 */
export function fragmentFindings(fragment: Fragment, result: SandboxFileResult | undefined): StyleFinding[] {
  if (!result || result.parseError) return [];
  return [...lintFindings(fragment, result), ...formatFindings(fragment, result)];
}

function lintFindings(fragment: Fragment, result: SandboxFileResult): StyleFinding[] {
  const findings: StyleFinding[] = [];
  const seen = new Set<string>();
  for (const diagnostic of result.diagnostics) {
    const line = fragment.hunk.lines[diagnostic.line - 1];
    if (!line?.added || seen.has(`${diagnostic.ruleId}:${line.line}`)) continue;
    seen.add(`${diagnostic.ruleId}:${line.line}`);
    const severity: Severity = WARNING_RULE.test(diagnostic.ruleId) ? "warning" : "info";
    findings.push({
      ruleId: `style/${diagnostic.ruleId}`,
      title: diagnostic.message.split("\n")[0]!.slice(0, 120),
      description: `${diagnostic.ruleId}: ${diagnostic.message}${diagnostic.fixable ? " (auto-fixable with the linter's --fix)" : ""}`,
      location: { filePath: fragment.file.path, lineStart: line.line, lineEnd: line.line },
      severity,
      confidence: 0.95,
    });
  }
  return findings;
}

function formatFindings(fragment: Fragment, result: SandboxFileResult): StyleFinding[] {
  if (result.formatted === undefined) return [];
  const tool = fragment.file.language === "python" ? "black" : "prettier";
  const before = fragment.hunk.lines;
  const after = result.formatted
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => (line === "" ? "" : fragment.indent + line));
  if (after.length === before.length && after.every((line, i) => line === before[i]!.text)) return [];

  const finding = (start: number, end: number, original: string[], suggested: string[] | undefined): StyleFinding => ({
    ruleId: `style/${tool}`,
    title: `Formatting differs from ${tool}`,
    description: suggested
      ? `${tool} reformats these lines; the fix below is deterministic and safe to apply (FR-STY-03).`
      : `${tool} would reformat this hunk, which also touches unchanged lines; run ${tool} on the file.`,
    location: { filePath: fragment.file.path, lineStart: start, lineEnd: end },
    severity: "info",
    confidence: 1,
    ...(suggested
      ? { suggestion: { kind: "deterministic" as const, originalSnippet: original.join("\n"), suggestedSnippet: suggested.join("\n"), explanation: `Formatted with ${tool}.` } }
      : {}),
  });

  // Blocks of added lines get a fix; reformatting of unchanged lines is not this PR's business.
  const fixable: Block[] = [];
  const touchesContext: number[] = [];
  for (const block of changedBlocks(before.map((line) => line.text), after)) {
    const lines = before.slice(block.aStart, block.aEnd);
    if (lines.every((line) => line.added)) {
      const previous = fixable.at(-1);
      if (previous && previous.aEnd === block.aStart && previous.bEnd === block.bStart) {
        previous.aEnd = block.aEnd;
        previous.bEnd = block.bEnd;
      } else {
        fixable.push({ ...block });
      }
    } else if (lines.length > 1 && lines.some((line) => line.added)) {
      // Lines were split or joined across old and new code: no safe line-level fix.
      touchesContext.push(...lines.filter((line) => line.added).map((line) => line.line));
    }
  }

  const findings = fixable.map((block) => {
    const lines = before.slice(block.aStart, block.aEnd);
    return finding(lines[0]!.line, lines.at(-1)!.line, lines.map((line) => line.text), after.slice(block.bStart, block.bEnd));
  });
  if (touchesContext.length) {
    findings.push(finding(Math.min(...touchesContext), Math.max(...touchesContext), [], undefined));
  }
  return findings;
}

interface Block {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

/** Past this many lines a hunk is compared as one block instead of line by line. */
const MAX_DIFF_LINES = 400;

/** Lines that differ only in whitespace or a trailing `;` / `,` are the same line, reformatted. */
const lineKey = (line: string) => line.replace(/\s+/g, "").replace(/[;,]+$/, "");

/**
 * The regions where `a` and `b` differ. Lines are aligned by a longest common subsequence of
 * their keys, so a reformatted line pairs with its original and becomes a one-line block; lines
 * that were split or joined form larger blocks. A pure insertion is widened to include the line
 * before it, so every block replaces at least one line.
 */
export function changedBlocks(a: string[], b: string[]): Block[] {
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) return [{ aStart: 0, aEnd: a.length, bStart: 0, bEnd: b.length }];
  const ka = a.map(lineKey);
  const kb = b.map(lineKey);

  // lcs[i][j] = length of the LCS of ka[i..] and kb[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = ka[i] === kb[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const blocks: Block[] = [];
  let i = 0;
  let j = 0;
  let open: Block | undefined;
  const close = () => {
    if (open && open.aEnd - open.aStart === open.bEnd - open.bStart) {
      // Same number of lines on both sides (e.g. quotes changed): they correspond one to one.
      for (let k = 0; k < open.aEnd - open.aStart; k++) {
        blocks.push({ aStart: open.aStart + k, aEnd: open.aStart + k + 1, bStart: open.bStart + k, bEnd: open.bStart + k + 1 });
      }
    } else if (open) {
      blocks.push(open);
    }
    open = undefined;
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && ka[i] === kb[j]) {
      close();
      if (a[i] !== b[j]) blocks.push({ aStart: i, aEnd: i + 1, bStart: j, bEnd: j + 1 });
      i++;
      j++;
      continue;
    }
    open ??= { aStart: i, aEnd: i, bStart: j, bEnd: j };
    if (j < b.length && (i === a.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) open.bEnd = ++j;
    else open.aEnd = ++i;
  }
  close();

  const result: Block[] = [];
  for (const block of blocks) {
    const previous = result.at(-1);
    if (block.aEnd > block.aStart) {
      result.push(block);
    } else if (previous && previous.aEnd === block.aStart && previous.bEnd === block.bStart) {
      // Pure insertion right after a changed line: extend that block.
      previous.bEnd = block.bEnd;
    } else if (block.aStart > 0) {
      // Pure insertion (e.g. blank lines added by black): attach it to the line before.
      result.push({ aStart: block.aStart - 1, aEnd: block.aEnd, bStart: block.bStart - 1, bEnd: block.bEnd });
    } else {
      result.push({ aStart: 0, aEnd: 1, bStart: block.bStart, bEnd: block.bEnd + 1 });
    }
  }
  return result;
}
