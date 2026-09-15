import type { Finding, ReviewSummary } from "@code-sentinel/contracts";

/**
 * Rolls a de-duplicated finding list up into the counts shown on the summary strip of every
 * client (the "2 Critical / 3 Warnings / 8 Auto-fixed" header).
 */
export function buildReviewSummary(findings: Finding[]): ReviewSummary {
  const summary: ReviewSummary = {
    criticalCount: 0,
    warningCount: 0,
    infoCount: 0,
    autoFixedCount: 0,
    suggestedFixCount: 0,
  };

  for (const finding of findings) {
    if (finding.severity === "critical") summary.criticalCount += 1;
    else if (finding.severity === "warning") summary.warningCount += 1;
    else summary.infoCount += 1;

    if (finding.suggestion?.kind === "deterministic") summary.autoFixedCount += 1;
    else if (finding.suggestion?.kind === "ai_suggested") summary.suggestedFixCount += 1;
  }

  return summary;
}
