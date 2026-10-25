import {
  AgentKindSchema,
  type AgentKind,
  type AgentResult,
  type CombinedReport,
  type Finding,
  type ReviewDetail,
  type ReviewListItem,
  type ReviewStatus,
} from "@code-sentinel/contracts";

import type { ReviewRecord, SuggestionRecord } from "../persistence/stores.js";

const EMPTY_SUMMARY = { criticalCount: 0, warningCount: 0, infoCount: 0, autoFixedCount: 0, suggestedFixCount: 0 };
const RANK: Record<"critical" | "warning" | "info", number> = { critical: 3, warning: 2, info: 1 };

const apiStatus = (status: ReviewRecord["status"]): ReviewStatus => (status === "cancelled" ? "failed" : status);
const running = (status: ReviewRecord["status"]) => status === "queued" || status === "running";

/**
 * Each agent's worst finding at or above the review's threshold (what was posted), counting its notes on
 * findings clubbed under another agent; `clean` when it ran and found nothing there, `not_run` when it
 * was off, skipped or gave no result.
 */
export function agentResults(record: Pick<ReviewRecord, "status" | "confidenceThreshold" | "report">): { agent: AgentKind; result: AgentResult }[] {
  const { report } = record;
  const posted = (report?.findings ?? [])
    .filter((finding) => finding.confidence >= record.confidenceThreshold)
    .flatMap((finding) => [{ agent: finding.agent, severity: finding.severity }, ...(finding.alsoReportedBy ?? [])]);
  return AgentKindSchema.options.map((agent) => {
    const run = report?.agentRuns.find((r) => r.agent === agent);
    if (!run) return { agent, result: running(record.status) && !report ? "running" : "not_run" };
    if (run.status !== "succeeded") return { agent, result: "not_run" };
    const worst = posted
      .filter((note) => note.agent === agent)
      .reduce<"critical" | "warning" | "info" | undefined>((top, f) => (!top || RANK[f.severity] > RANK[top] ? f.severity : top), undefined);
    return { agent, result: worst ?? "clean" };
  });
}

export function toListItem(record: ReviewRecord): ReviewListItem {
  return {
    reviewId: record.reviewId,
    repositoryId: record.repositoryId,
    repositoryFullName: record.repositoryFullName,
    trigger: record.trigger,
    ...(record.prNumber !== undefined ? { pullRequestNumber: record.prNumber } : {}),
    ...(record.prTitle !== undefined ? { pullRequestTitle: record.prTitle } : {}),
    headSha: record.headSha,
    status: apiStatus(record.status),
    ...(record.checkConclusion ? { checkConclusion: record.checkConclusion } : {}),
    summary: record.report?.summary ?? EMPTY_SUMMARY,
    agentResults: agentResults(record),
    ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
    createdAt: record.createdAt.toISOString(),
  };
}

/** The stored report plus where it came from; a review still running has no report yet, so it gets an empty one. */
/** The same finding in the report JSON and in the `findings` rows the orchestrator wrote from it. */
const findingKey = (f: { agent: string; ruleId: string; filePath: string; lineStart: number; lineEnd: number }) =>
  `${f.agent}|${f.ruleId}|${f.filePath}|${f.lineStart}|${f.lineEnd}`;

/**
 * Adds each fix's row (UC-3) to the report's findings: the finding id the accept and reject routes take,
 * and the fix's state, commit or dismissal reason.
 */
function withDecisions(findings: Finding[], suggestions: readonly SuggestionRecord[]): Finding[] {
  const byKey = new Map(suggestions.map((s) => [findingKey(s), s]));
  return findings.map((finding) => {
    const row = finding.suggestion ? byKey.get(findingKey({ ...finding, ...finding.location })) : undefined;
    if (!row || !finding.suggestion) return finding;
    byKey.delete(findingKey(row));
    return {
      ...finding,
      id: row.findingId,
      suggestion: {
        ...finding.suggestion,
        id: row.suggestionId,
        state: row.state,
        ...(row.resolutionCommitSha ? { commitSha: row.resolutionCommitSha } : {}),
        ...(row.rejectionReason ? { rejectionReason: row.rejectionReason } : {}),
      },
    };
  });
}

export function toDetail(record: ReviewRecord, suggestions: readonly SuggestionRecord[] = []): ReviewDetail {
  // Still running: no report yet, and `agentRuns` lists the agents that have answered so far.
  const report: CombinedReport = record.report ?? {
    reviewId: record.reviewId,
    status: apiStatus(record.status),
    summary: EMPTY_SUMMARY,
    findings: [],
    agentRuns: running(record.status) ? (record.agentProgress ?? []) : [],
  };
  return {
    ...report,
    findings: withDecisions(report.findings, suggestions),
    // The row is the source of truth for these, whatever the report carried.
    reviewId: record.reviewId,
    status: apiStatus(record.status),
    repositoryId: record.repositoryId,
    repositoryFullName: record.repositoryFullName,
    trigger: record.trigger,
    ...(record.prNumber !== undefined ? { pullRequestNumber: record.prNumber } : {}),
    ...(record.prTitle !== undefined ? { pullRequestTitle: record.prTitle } : {}),
    headSha: record.headSha,
    ...(record.headRef !== undefined ? { headRef: record.headRef } : {}),
    ...(record.baseRef !== undefined ? { baseRef: record.baseRef } : {}),
    confidenceThreshold: record.confidenceThreshold,
    ...(record.checkConclusion ? { checkConclusion: record.checkConclusion } : {}),
    agentResults: agentResults(record),
    createdAt: record.createdAt.toISOString(),
    ...(record.startedAt ? { startedAt: record.startedAt.toISOString() } : {}),
  };
}
