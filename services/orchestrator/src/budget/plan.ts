import type { ChangedFile, SkippedFile } from "@code-sentinel/contracts";
import { estimateTokens } from "@code-sentinel/llm";

export interface PlanLimits {
  /** A larger file is `too_large` (`LLM_MAX_FILE_TOKENS`). */
  maxFileTokens: number;
  /** Diff tokens per LLM call (`LLM_MAX_BATCH_TOKENS`). */
  maxBatchTokens: number;
  /** Diff tokens per agent per review; the rest is `over_budget` (`LLM_REVIEW_MAX_TOKENS`). */
  reviewMaxTokens: number;
}

export interface LlmBatch {
  files: ChangedFile[];
  /** Estimated diff tokens of the files in this batch. */
  tokens: number;
}

export interface LlmReviewPlan {
  batches: LlmBatch[];
  skipped: SkippedFile[];
}

/** What the LLM sees of a file: its hunks plus any context the gateway attached. */
export function fileTokens(file: ChangedFile): number {
  return estimateTokens(file.patch) + (file.contextBefore ? estimateTokens(file.contextBefore) : 0);
}

/**
 * `ReviewPlanner.planLlmReview` (`class_llm.mmd`): source files first, then smallest first, so the
 * review budget covers as many real files as possible. Files are never split: one over
 * `maxFileTokens` is `too_large`, and whatever does not fit `reviewMaxTokens` is `over_budget`.
 * The rest is packed in that order into batches of at most `maxBatchTokens`.
 */
export function planLlmReview(files: readonly ChangedFile[], limits: PlanLimits): LlmReviewPlan {
  const sized = files
    .map((file, index) => ({ file, index, tokens: fileTokens(file) }))
    .sort((a, b) => isSource(b.file) - isSource(a.file) || a.tokens - b.tokens || a.index - b.index);

  const batches: LlmBatch[] = [];
  const skipped: SkippedFile[] = [];
  let used = 0;
  for (const { file, tokens } of sized) {
    if (tokens > limits.maxFileTokens) {
      skipped.push({ path: file.path, reason: "too_large" });
      continue;
    }
    if (used + tokens > limits.reviewMaxTokens) {
      skipped.push({ path: file.path, reason: "over_budget" });
      continue;
    }
    used += tokens;
    const last = batches.at(-1);
    if (last && last.tokens + tokens <= limits.maxBatchTokens) {
      last.files.push(file);
      last.tokens += tokens;
    } else {
      batches.push({ files: [file], tokens });
    }
  }
  return { batches, skipped };
}

function isSource(file: ChangedFile): number {
  return file.language === "unknown" ? 0 : 1;
}
