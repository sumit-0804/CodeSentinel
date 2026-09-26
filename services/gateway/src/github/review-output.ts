import type { AgentKind, AgentRunSummary, CombinedReport, Finding, ReviewJob, Severity } from "@code-sentinel/contracts";

import type { CheckAnnotation, CheckConclusion, CheckRunOutput, ReviewComment } from "./github-client.js";

export const CHECK_NAME = "Code-Sentinel";
/** GitHub's per-review comment count is capped here; the rest are counted in the Check Run. */
export const MAX_REVIEW_COMMENTS = 50;

/** Agents whose findings are posted inline even without a fix (FR-GH-03). */
const INLINE_AGENTS: ReadonlySet<AgentKind> = new Set(["security", "logic", "performance"]);
const TERMINAL = new Set(["completed", "partial", "failed", "cancelled"]);
/** GitHub rejects a Check Run summary over 65,535 characters and an annotation message over 64 KB. */
const MAX_SUMMARY = 60_000;
const MAX_MESSAGE = 4_000;

const SEVERITY_LABEL: Record<Severity, string> = { critical: "🔴 Critical", warning: "🟠 Warning", info: "🔵 Info" };
const AGENT_LABEL: Record<AgentKind, string> = {
  security: "Security",
  style: "Style",
  performance: "Performance",
  logic: "Logic",
  documentation: "Documentation",
};
const SKIP_REASON: Record<string, string> = {
  unsupported_language: "unsupported language",
  too_large: "too large",
  generated_file: "generated or vendored",
  binary: "binary",
  over_budget: "over the review budget",
};

export function isTerminal(job: ReviewJob): boolean {
  return TERMINAL.has(job.status);
}

/** The findings that clear the repository's confidence threshold (FR-ORC-06); only these are posted. */
export function postable(report: CombinedReport, threshold: number): Finding[] {
  return report.findings.filter((finding) => finding.confidence >= threshold);
}

/**
 * FR-GH-02: `failure` when a postable finding is critical; otherwise `neutral` when the review did
 * not fully complete; otherwise `success`. A critical issue fails the check even on a partial review.
 */
export function checkRunConclusion(job: ReviewJob, threshold: number): CheckConclusion {
  if (job.report && postable(job.report, threshold).some((finding) => finding.severity === "critical")) return "failure";
  return job.status === "completed" && job.report ? "success" : "neutral";
}

/** Title, markdown summary and line annotations for the Check Run; `notes` are appended to the summary. */
export function checkRunOutput(job: ReviewJob, threshold: number, notes: string[] = []): CheckRunOutput {
  const report = job.report;
  if (!report) {
    const reason = job.error?.message ?? `The review ended as \`${job.status}\` without a report.`;
    return { title: "Review did not complete", summary: [reason, ...notes].join("\n\n"), annotations: [] };
  }

  const shown = postable(report, threshold);
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const finding of shown) counts[finding.severity]++;
  const title = shown.length
    ? [`${counts.critical} critical`, `${counts.warning} warning`, `${counts.info} info`].filter((part) => !part.startsWith("0 ")).join(" · ")
    : "No issues found";

  const lines: string[] = [`**${title}** · review \`${report.status}\``, ""];
  if (report.coverage) {
    const c = report.coverage;
    lines.push(`Reviewed ${c.filesReviewed} of ${c.filesTotal} files · ${c.changedLinesReviewed} of ${c.changedLinesTotal} changed lines`, "");
  }
  lines.push("**Agents**", ...report.agentRuns.map(agentLine), "");
  if (report.skippedFiles?.length) {
    lines.push(
      "**Skipped files**",
      ...report.skippedFiles.map((file) => `- \`${file.path}\` — ${SKIP_REASON[file.reason] ?? file.reason}${file.agents ? ` (${file.agents.join(", ")})` : ""}`),
      "",
    );
  }
  const hidden = report.findings.length - shown.length;
  if (hidden > 0) lines.push(`${hidden} lower-confidence finding${hidden === 1 ? "" : "s"} below the threshold (${threshold}) not shown.`, "");
  lines.push(...notes);

  return { title, summary: lines.join("\n").trim().slice(0, MAX_SUMMARY), annotations: shown.map(annotation) };
}

/**
 * FR-GH-03 / FR-GH-04: one inline comment per postable finding that carries a fix, plus Security,
 * Logic and Performance findings without one. A fix is a ```suggestion block the author commits
 * with one click; nothing is ever pushed. At most `MAX_REVIEW_COMMENTS`, highest ranked first.
 */
export function reviewComments(job: ReviewJob, threshold: number): ReviewComment[] {
  if (!job.report) return [];
  return postable(job.report, threshold)
    .filter((finding) => finding.suggestion || INLINE_AGENTS.has(finding.agent))
    .slice(0, MAX_REVIEW_COMMENTS)
    .map((finding) => {
      const { filePath, lineStart, lineEnd } = finding.location;
      return { path: filePath, line: lineEnd, ...(lineStart < lineEnd ? { startLine: lineStart } : {}), body: commentBody(finding) };
    });
}

/** How many postable findings would be inline comments beyond the cap. */
export function droppedComments(job: ReviewJob, threshold: number): number {
  if (!job.report) return 0;
  const eligible = postable(job.report, threshold).filter((finding) => finding.suggestion || INLINE_AGENTS.has(finding.agent)).length;
  return Math.max(0, eligible - MAX_REVIEW_COMMENTS);
}

function commentBody(finding: Finding): string {
  const heading = `**${SEVERITY_LABEL[finding.severity]} · ${AGENT_LABEL[finding.agent]}** — ${finding.title}${finding.cweId ? ` (${finding.cweId})` : ""}`;
  const parts = [heading, "", finding.description];
  if (finding.suggestion) {
    const snippet = finding.suggestion.suggestedSnippet;
    // A fence longer than any backtick run inside the snippet, so the snippet cannot close it.
    const fence = "`".repeat(Math.max(3, ...[...snippet.matchAll(/`+/g)].map((run) => run[0].length + 1)));
    parts.push(
      "",
      `${fence}suggestion`,
      snippet,
      fence,
      finding.suggestion.kind === "deterministic"
        ? `_Deterministic fix (${finding.ruleId.replace(/^style\//, "")}): safe to apply._`
        : "_AI-suggested fix: review it before committing._",
    );
  }
  return parts.join("\n");
}

function annotation(finding: Finding): CheckAnnotation {
  const { filePath, lineStart, lineEnd } = finding.location;
  return {
    path: filePath,
    startLine: lineStart,
    endLine: lineEnd,
    level: finding.severity === "critical" ? "failure" : finding.severity === "warning" ? "warning" : "notice",
    title: `${AGENT_LABEL[finding.agent]}: ${finding.title}${finding.cweId ? ` (${finding.cweId})` : ""}`.slice(0, 255),
    message: finding.description.slice(0, MAX_MESSAGE),
  };
}

function agentLine(run: AgentRunSummary): string {
  const name = AGENT_LABEL[run.agent];
  const took = run.latencyMs !== undefined ? ` (${(run.latencyMs / 1000).toFixed(1)} s)` : "";
  if (run.status === "succeeded") {
    const via = run.llmProvider ? ` via ${run.llmProvider}` : "";
    const deferred = run.errorCode === "llm_quota_exhausted" ? "; part of the LLM analysis deferred (quota)" : "";
    return `- ✅ ${name} — ${run.findingsCount ?? 0} finding${run.findingsCount === 1 ? "" : "s"}${via}${took}${deferred}`;
  }
  if (run.status === "skipped") {
    if (run.errorCode === "llm_quota_exhausted") return `- ⏸️ ${name} — LLM analysis deferred (quota)`;
    return `- ➖ ${name} — ${run.errorCode === "agent_not_configured" ? "not configured" : "skipped"}`;
  }
  return `- ⚠️ ${name} — no result (${run.status === "timed_out" ? "timed out" : (run.errorCode ?? "failed")})${took}`;
}
