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
 * Postable findings that block the merge: every critical one, whichever agent found it (FR-GH-02),
 * and the warnings of agents in `block` mode, counting every agent of a clubbed finding. Comment
 * mode only keeps warnings from blocking.
 */
function blockingFindings(report: CombinedReport, threshold: number, blockingAgents: readonly AgentKind[]): Finding[] {
  return postable(report, threshold).filter(
    (finding) => finding.severity === "critical" || (finding.severity === "warning" && reportingAgents(finding).some((agent) => blockingAgents.includes(agent))),
  );
}

function reportingAgents(finding: Finding): AgentKind[] {
  return [finding.agent, ...(finding.alsoReportedBy ?? []).map((note) => note.agent)];
}

/**
 * FR-GH-02 with A9's agent modes: `failure` when a postable finding blocks the merge (see
 * `blockingFindings`), even on a partial review; `neutral` for an incomplete review; otherwise `success`.
 */
export function checkRunConclusion(job: ReviewJob, threshold: number, blockingAgents: readonly AgentKind[]): CheckConclusion {
  if (!job.report || job.status === "cancelled") return "neutral";
  if (blockingFindings(job.report, threshold, blockingAgents).length > 0) return "failure";
  return job.status === "completed" ? "success" : "neutral";
}

/** Title, markdown summary and line annotations for the Check Run; `notes` are appended to the summary. */
export function checkRunOutput(job: ReviewJob, threshold: number, blockingAgents: readonly AgentKind[], notes: string[] = []): CheckRunOutput {
  // The gateway cancels a review only when a newer commit (or a re-run) replaces it.
  if (job.status === "cancelled") {
    return { title: "Superseded by a newer commit", summary: ["A newer review of this pull request replaced this one.", ...notes].join("\n\n"), annotations: [] };
  }
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
  const placeCount = places(shown).length;
  if (placeCount < shown.length) lines.push(`${plural(shown.length, "finding")} in ${plural(placeCount, "place")}.`, "");
  const blocking = blockingFindings(report, threshold, blockingAgents);
  if (blocking.length > 0) {
    const critical = blocking.filter((finding) => finding.severity === "critical").length;
    const warnings = blocking.length - critical;
    const counts = [critical ? plural(critical, "critical finding") : "", warnings ? plural(warnings, "warning") : ""].filter(Boolean).join(" and ");
    lines.push(`Merge blocked by ${agentList(blocking.flatMap(reportingAgents), true)}: ${counts}.`, "");
  }
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

/** The Check Run for a pull request whose every changed file was skipped: nothing goes to the agents. */
export function nothingToReviewOutput(skippedFiles: readonly { path: string; reason: string }[]): CheckRunOutput {
  // Removed files and pure renames are dropped without a reason, so the list can be empty.
  const lines = skippedFiles.length
    ? [
        "Every changed file was skipped, so no agent ran.",
        "",
        "**Skipped files**",
        ...skippedFiles.map((file) => `- \`${file.path}\` — ${SKIP_REASON[file.reason] ?? file.reason}`),
      ]
    : ["This pull request only removes or renames files, so there are no changed lines to review."];
  return { title: "Nothing to review", summary: lines.join("\n").slice(0, MAX_SUMMARY), annotations: [] };
}

/** Which agent's fix wins when several touch the same lines: in a shared comment, and in "Apply all fixes". */
export const FIX_PRIORITY: readonly AgentKind[] = ["security", "logic", "performance", "style", "documentation"];

/** Findings in the same file on overlapping lines; the report's ranking order is kept inside each place. */
interface Place {
  path: string;
  start: number;
  end: number;
  findings: Finding[];
}

function places(findings: Finding[]): Place[] {
  const found: Place[] = [];
  for (const finding of findings) {
    const { filePath, lineStart, lineEnd } = finding.location;
    const place = found.find((p) => p.path === filePath && lineStart <= p.end && p.start <= lineEnd);
    if (place) {
      place.findings.push(finding);
      place.start = Math.min(place.start, lineStart);
      place.end = Math.max(place.end, lineEnd);
    } else {
      found.push({ path: filePath, start: lineStart, end: lineEnd, findings: [finding] });
    }
  }
  return found;
}

/** The fix a place's comment carries: by agent priority, then confidence. */
function chosenFix(place: Place): Finding | undefined {
  return place.findings
    .filter((finding) => finding.suggestion)
    .sort((a, b) => FIX_PRIORITY.indexOf(a.agent) - FIX_PRIORITY.indexOf(b.agent) || b.confidence - a.confidence)[0];
}

/** Postable findings that get an inline comment: every one with a fix, plus Security, Logic and Performance without one. */
function commentPlaces(job: ReviewJob, threshold: number): Place[] {
  if (!job.report) return [];
  return places(postable(job.report, threshold).filter((finding) => finding.suggestion || INLINE_AGENTS.has(finding.agent)));
}

/**
 * FR-GH-03 / FR-GH-04: **one inline comment per place** (same file, overlapping lines), listing every
 * agent's note there. It carries at most one ```suggestion, picked by `FIX_PRIORITY`, and spans exactly
 * that fix's lines so committing it replaces the right ones. At most `MAX_REVIEW_COMMENTS`, highest ranked first.
 */
export function reviewComments(job: ReviewJob, threshold: number): ReviewComment[] {
  return commentPlaces(job, threshold)
    .slice(0, MAX_REVIEW_COMMENTS)
    .map((place) => {
      const fix = chosenFix(place);
      const [start, end] = fix ? [fix.location.lineStart, fix.location.lineEnd] : [place.start, place.end];
      return { path: place.path, line: end, ...(start < end ? { startLine: start } : {}), body: commentBody(place, fix) };
    });
}

/** The findings whose fix is in a posted comment, so stored suggestions are paired only with those comments. */
export function postedFixes(job: ReviewJob, threshold: number): Finding[] {
  return commentPlaces(job, threshold)
    .slice(0, MAX_REVIEW_COMMENTS)
    .flatMap((place) => chosenFix(place) ?? []);
}

/** How many places would be inline comments beyond the cap. */
export function droppedComments(job: ReviewJob, threshold: number): number {
  return Math.max(0, commentPlaces(job, threshold).length - MAX_REVIEW_COMMENTS);
}

function noteHeading(note: Pick<Finding, "severity" | "agent" | "title" | "cweId">): string {
  return `**${SEVERITY_LABEL[note.severity]} · ${AGENT_LABEL[note.agent]}** — ${note.title}${note.cweId ? ` (${note.cweId})` : ""}`;
}

function commentBody(place: Place, fix: Finding | undefined): string {
  const notes = place.findings.flatMap((finding) => [finding, ...(finding.alsoReportedBy ?? [])]);
  const parts: string[] = [];
  if (notes.length > 1) parts.push(`**Flagged by ${agentList(notes.map((note) => note.agent))}**`, "");
  parts.push(...notes.flatMap((note, i) => [...(i > 0 ? [""] : []), noteHeading(note), "", note.description]));
  const seen = seenBefore(place.findings);
  if (seen) parts.push("", seen);
  if (fix?.suggestion) {
    const snippet = fix.suggestion.suggestedSnippet;
    // A fence longer than any backtick run inside the snippet, so the snippet cannot close it.
    const fence = "`".repeat(Math.max(3, ...[...snippet.matchAll(/`+/g)].map((run) => run[0].length + 1)));
    parts.push(
      "",
      `${fence}suggestion`,
      snippet,
      fence,
      fix.suggestion.kind === "deterministic"
        ? `_Deterministic fix (${fix.ruleId.replace(/^style\//, "")}): safe to apply._`
        : `_AI-suggested fix${notes.length > 1 ? ` from ${AGENT_LABEL[fix.agent]}` : ""}: review it before committing._`,
    );
  }
  const otherFixes = place.findings.filter((finding) => finding.suggestion && finding !== fix);
  if (otherFixes.length) {
    parts.push("", `_Another fix (${agentList(otherFixes.map((finding) => finding.agent))}) is on the Code Sentinel dashboard._`);
  }
  return parts.join("\n");
}

/** One line about similar past issues (vector context), naming the closest one and how it ended. */
function seenBefore(findings: readonly Finding[]): string | undefined {
  const byId = new Map(findings.flatMap((finding) => finding.similarPastIssues ?? []).map((issue) => [issue.findingId, issue]));
  const issues = [...byId.values()].sort((a, b) => b.similarityScore - a.similarityScore);
  const closest = issues[0];
  if (!closest) return undefined;
  const where =
    closest.repositoryFullName && closest.pullRequestNumber !== undefined
      ? `${closest.repositoryFullName}#${closest.pullRequestNumber}`
      : (closest.repositoryFullName ?? `"${closest.title}"`);
  const count = issues.length === 1 ? "a similar issue" : `${issues.length} similar issues`;
  return `_Seen before: ${count}; closest in ${where}${closest.resolution ? ` (${closest.resolution})` : ""}._`;
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

/** "Security and Logic" (bold when asked), each agent once, in contract order. */
function agentList(agents: AgentKind[], bold = false): string {
  const names = (Object.keys(AGENT_LABEL) as AgentKind[])
    .filter((agent) => agents.includes(agent))
    .map((agent) => (bold ? `**${AGENT_LABEL[agent]}**` : AGENT_LABEL[agent]));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
