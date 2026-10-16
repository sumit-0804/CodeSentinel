import type { AgentResult, CheckConclusion, Finding, ReviewListItem, ReviewStatus, ReviewSummary } from "@code-sentinel/contracts";
import type { LaneState } from "@/components/brand/verdict";

export type Verdict = "running" | "blocked" | "passed" | "partial" | "failed";

/**
 * What a review means for the merge. The stored Check Run conclusion decides it (A9's agent modes);
 * reviews from before it was stored fall back to the old rule, any critical finding blocks.
 */
export function verdictOf({ status, checkConclusion, summary }: { status: ReviewStatus; checkConclusion?: CheckConclusion; summary: ReviewSummary }): Verdict {
  if (status === "queued" || status === "running") return "running";
  if (status === "failed") return "failed";
  if (checkConclusion === "fail" || (!checkConclusion && summary.criticalCount > 0)) return "blocked";
  return status === "partial" ? "partial" : "passed";
}

export function verdictSentence(verdict: Verdict, summary: ReviewSummary): string {
  const critical = summary.criticalCount;
  switch (verdict) {
    case "running":
      return "Agents are still reading the changes.";
    case "failed":
      return "The review couldn't finish.";
    case "blocked":
      if (critical === 0) return "Warnings from an agent set to Block merge stop this merge.";
      return critical === 1 ? "One critical finding stops this merge." : `${critical} critical findings stop this merge.`;
    case "partial":
      return "Reviewed, but not every agent finished.";
    case "passed":
      return critical > 0 ? "Critical findings were posted as comments; nothing blocks this merge." : "Nothing blocks this merge.";
  }
}

const LANE: Record<AgentResult, LaneState> = { critical: "c", warning: "w", info: "i", clean: "ok", not_run: "off", running: "run" };

/** The five verdict lanes, in agent order; all "not run" when the API sent none. */
export function lanesOf(agentResults: ReviewListItem["agentResults"]): LaneState[] {
  return agentResults?.length === 5 ? agentResults.map(({ result }) => LANE[result]) : ["off", "off", "off", "off", "off"];
}

/** Findings by file, files in the order their first finding appears (the report is already ranked). */
export function groupByFile(findings: Finding[]): { path: string; findings: Finding[] }[] {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const path = finding.location.filePath;
    groups.set(path, [...(groups.get(path) ?? []), finding]);
  }
  return [...groups].map(([path, items]) => ({ path, findings: items }));
}

export const postedCount = (confidences: number[], threshold: number) => confidences.filter((c) => c >= threshold - 1e-9).length;

/** "just now", "4 min ago", "3 h ago", "2 days ago". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

const EXACT = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

/** "12 Oct 2026, 07:03 UTC": fixed locale and zone, so server and browser render the same text. */
export const exactTime = (iso: string) => `${EXACT.format(new Date(iso))} UTC`;
