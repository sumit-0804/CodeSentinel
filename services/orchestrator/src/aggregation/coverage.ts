import type { AgentRunSummary, ChangedFile, ReviewCoverage, SkippedFile } from "@code-sentinel/contracts";

import type { AgentSkippedFiles } from "./skipped-files.js";

/** Added and removed lines in a unified diff, not counting the `+++` / `---` headers. */
export function countChangedLines(patch: string): number {
  let count = 0;
  for (const line of patch.split("\n")) {
    if ((line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---"))) count++;
  }
  return count;
}

/**
 * `CombinedReport.coverage`: a file counts as reviewed when at least one agent that succeeded did
 * not skip it. Gateway-dropped files count toward `filesTotal` but carry no patch, so they add no
 * changed lines.
 */
export function buildCoverage(
  files: ChangedFile[],
  gatewaySkipped: SkippedFile[],
  agentRuns: AgentRunSummary[],
  agentSkipped: AgentSkippedFiles[],
): ReviewCoverage {
  const succeeded = agentRuns.filter((run) => run.status === "succeeded").map((run) => run.agent);
  const skippedBy = new Map(agentSkipped.map(({ agent, files: skipped }) => [agent, new Set(skipped.map((file) => file.path))]));
  const reviewed = files.filter((file) => succeeded.some((agent) => !skippedBy.get(agent)?.has(file.path)));

  const lines = (list: ChangedFile[]) => list.reduce((total, file) => total + countChangedLines(file.patch), 0);
  return {
    filesTotal: files.length + gatewaySkipped.length,
    filesReviewed: reviewed.length,
    changedLinesTotal: lines(files),
    changedLinesReviewed: lines(reviewed),
  };
}
