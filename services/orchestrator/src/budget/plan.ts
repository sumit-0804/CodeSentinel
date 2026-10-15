import type { ChangedFile, OtherChange, SkippedFile } from "@code-sentinel/contracts";
import { estimateTokens } from "@code-sentinel/llm";

import { relatedFileGroups } from "./related-files.js";

export interface PlanLimits {
  /** A file over this is reviewed from its diff, and a diff over it is `too_large` (`LLM_MAX_FILE_TOKENS`). */
  maxFileTokens: number;
  /** File tokens per LLM call (`LLM_MAX_BATCH_TOKENS`). */
  maxBatchTokens: number;
  /** File tokens per agent per review; the rest is `over_budget` (`LLM_REVIEW_MAX_TOKENS`). */
  reviewMaxTokens: number;
  /** Diffs of the pull request's other files sent with each call (`LLM_OTHER_CHANGES_TOKENS`); 0 sends paths only. */
  otherChangesTokens?: number;
}

export interface LlmBatch {
  files: ChangedFile[];
  /** Estimated tokens of the files in this batch. */
  tokens: number;
  /** The pull request's other changed files, as context for this call. */
  otherChanges: OtherChange[];
  /** Estimated tokens of `otherChanges`; reserved with the call. */
  otherTokens: number;
}

export interface LlmReviewPlan {
  batches: LlmBatch[];
  skipped: SkippedFile[];
}

/** What the LLM sees of a file: its hunks, plus the whole file when the gateway attached it. */
export function fileTokens(file: ChangedFile): number {
  return estimateTokens(file.patch) + (file.content ? estimateTokens(file.content) : 0);
}

/**
 * `ReviewPlanner.planLlmReview` (`class_llm.mmd`). Files linked by imports form a group that goes
 * into one call, so a change is read with the changed code it uses. Groups go source first, then
 * smallest first, so the review budget covers as many real files as possible.
 * - A whole file over `maxFileTokens` is sent as its diff; a diff over it is `too_large`.
 * - A group over `maxBatchTokens` sends its largest files as diffs until it fits, else is split.
 * - Whatever does not fit `reviewMaxTokens` is `over_budget`.
 * Every batch also carries the rest of the pull request's diffs as `otherChanges`.
 */
export function planLlmReview(files: readonly ChangedFile[], limits: PlanLimits): LlmReviewPlan {
  const fitted = files.map((file) => (file.content !== undefined && fileTokens(file) > limits.maxFileTokens ? withoutContent(file) : file));
  const groups = relatedFileGroups(fitted)
    .map((indices) => indices.map((index) => ({ file: fitted[index]!, index })))
    .map((members) => ({ members, tokens: sum(members.map((m) => fileTokens(m.file))), source: Math.max(...members.map((m) => isSource(m.file))) }))
    .sort((a, b) => b.source - a.source || a.tokens - b.tokens || a.members[0]!.index - b.members[0]!.index);

  const batches: { files: ChangedFile[]; tokens: number; groups: Set<number> }[] = [];
  const skipped: SkippedFile[] = [];
  let used = 0;
  groups.forEach(({ members }, groupId) => {
    let kept = members.map((m) => m.file);
    for (const file of kept.filter((f) => fileTokens(f) > limits.maxFileTokens)) skipped.push({ path: file.path, reason: "too_large" });
    kept = kept.filter((f) => fileTokens(f) <= limits.maxFileTokens);
    kept = shrinkToBatch(kept, limits.maxBatchTokens);

    const admitted: ChangedFile[] = [];
    for (const file of kept) {
      const tokens = fileTokens(file);
      if (used + tokens > limits.reviewMaxTokens) {
        skipped.push({ path: file.path, reason: "over_budget" });
        continue;
      }
      used += tokens;
      admitted.push(file);
    }
    if (admitted.length === 0) return;

    const total = sum(admitted.map(fileTokens));
    const last = batches.at(-1);
    if (total <= limits.maxBatchTokens && last && last.tokens + total <= limits.maxBatchTokens) {
      last.files.push(...admitted);
      last.tokens += total;
      last.groups.add(groupId);
      return;
    }
    // Packed in order; a group that still does not fit one call spans consecutive batches.
    let current: (typeof batches)[number] | undefined;
    for (const file of admitted) {
      const tokens = fileTokens(file);
      if (!current || current.tokens + tokens > limits.maxBatchTokens) {
        current = { files: [], tokens: 0, groups: new Set([groupId]) };
        batches.push(current);
      }
      current.files.push(file);
      current.tokens += tokens;
    }
  });

  const groupOf = new Map<string, number>();
  groups.forEach(({ members }, groupId) => members.forEach((m) => groupOf.set(m.file.path, groupId)));
  return {
    batches: batches.map(({ files: batchFiles, tokens, groups: batchGroups }) => ({
      files: batchFiles,
      tokens,
      ...otherChangesFor(batchFiles, batchGroups, files, groupOf, limits.otherChangesTokens ?? 0),
    })),
    skipped,
  };
}

/** The rest of the pull request: linked files first, then in order; diffs until the budget is spent, then paths only. */
function otherChangesFor(
  batchFiles: ChangedFile[],
  batchGroups: Set<number>,
  all: readonly ChangedFile[],
  groupOf: Map<string, number>,
  budget: number,
): { otherChanges: OtherChange[]; otherTokens: number } {
  const inBatch = new Set(batchFiles.map((f) => f.path));
  const others = all.filter((f) => !inBatch.has(f.path));
  const linked = (f: ChangedFile) => (batchGroups.has(groupOf.get(f.path) ?? -1) ? 0 : 1);
  const ordered = others.map((file, index) => ({ file, index })).sort((a, b) => linked(a.file) - linked(b.file) || a.index - b.index);

  let otherTokens = 0;
  const otherChanges = ordered.map(({ file }): OtherChange => {
    const tokens = estimateTokens(file.patch) + estimateTokens(file.path);
    if (otherTokens + tokens > budget) return { path: file.path, changeType: file.changeType };
    otherTokens += tokens;
    return { path: file.path, changeType: file.changeType, patch: file.patch };
  });
  otherTokens += sum(otherChanges.filter((c) => c.patch === undefined).map((c) => estimateTokens(c.path)));
  return { otherChanges, otherTokens };
}

/** Sends the largest whole files as diffs until the group fits one call, or nothing whole is left. */
function shrinkToBatch(files: ChangedFile[], maxBatchTokens: number): ChangedFile[] {
  const result = [...files];
  while (sum(result.map(fileTokens)) > maxBatchTokens) {
    const whole = result.map((file, i) => ({ i, tokens: fileTokens(file) })).filter(({ i }) => result[i]!.content !== undefined);
    if (whole.length === 0) break;
    const largest = whole.reduce((a, b) => (b.tokens > a.tokens ? b : a));
    result[largest.i] = withoutContent(result[largest.i]!);
  }
  return result;
}

function withoutContent(file: ChangedFile): ChangedFile {
  const { content: _content, ...rest } = file;
  return rest;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function isSource(file: ChangedFile): number {
  return file.language === "unknown" ? 0 : 1;
}
