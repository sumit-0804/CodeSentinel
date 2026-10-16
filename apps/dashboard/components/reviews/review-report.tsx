"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { AgentRunSummary, Finding, Severity } from "@code-sentinel/contracts";
import { AGENTS, AgentGlyph } from "@/components/brand/agents";
import { SeverityDot } from "@/components/brand/verdict-pill";
import { FixActions } from "@/components/reviews/fix-actions";
import { cn } from "@/lib/utils";
import { groupByFile } from "@/lib/review-view";

const FILTERS: { key: "all" | Severity; label: string }[] = [
  { key: "all", label: "All" },
  { key: "critical", label: "Critical" },
  { key: "warning", label: "Warning" },
  { key: "info", label: "Info" },
];

const RUN_WORD: Record<AgentRunSummary["status"], string> = { succeeded: "", timed_out: "Timed out", failed: "No result", skipped: "Skipped" };

const agentName = (agent: Finding["agent"]) => AGENTS.find((a) => a.agent === agent)?.name ?? agent;

/** Before and after for a fix, as numbered lines starting at the finding's first line. */
function FixBlock({ finding }: { finding: Finding }) {
  const { suggestion, location } = finding;
  if (!suggestion) return null;
  const lines = (text: string) => text.replace(/\n$/, "").split("\n");
  const rows = [
    ...lines(suggestion.originalSnippet).map((text, i) => ({ ln: location.lineStart + i, sign: "−", text, cls: "bg-crit/12 [&_.s]:text-crit" })),
    ...lines(suggestion.suggestedSnippet).map((text, i) => ({ ln: location.lineStart + i, sign: "+", text, cls: "bg-pass/10 [&_.s]:text-pass" })),
  ];
  return (
    <div className="grid gap-2">
      <p className="text-[13px] font-semibold text-ink-2">
        {suggestion.kind === "deterministic" ? "Exact fix from the formatter" : "AI-suggested fix: review it before committing"}
      </p>
      <div role="img" aria-label="Suggested change" className="overflow-x-auto rounded-xl border border-line bg-[rgb(5_6_11/0.7)] py-1.5 font-mono text-xs leading-[1.95]">
        {rows.map((row, i) => (
          <div key={i} className={cn("grid grid-cols-[52px_22px_max-content] pr-5", row.cls)}>
            <span className="pr-3 text-right text-ink-3 select-none">{row.ln}</span>
            <span className="s text-ink-3 select-none">{row.sign}</span>
            <span className="whitespace-pre">{row.text || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The PR page's findings by file with severity filters, and the agent runs beside them. */
export function ReviewReport({
  findings,
  agentRuns,
  threshold,
  running,
  repositoryHref,
}: {
  findings: Finding[];
  agentRuns: AgentRunSummary[];
  threshold: number;
  running: boolean;
  repositoryHref?: string;
}) {
  const [filter, setFilter] = useState<"all" | Severity>("all");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const indexed = findings.map((finding, index) => ({ finding, index }));
  const shown = indexed.filter(({ finding }) => filter === "all" || finding.severity === filter);
  const toggle = (index: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-7 min-[1100px]:grid-cols-[minmax(0,1fr)_300px]">
      <section className="grid grid-cols-[minmax(0,1fr)] gap-3.5" aria-labelledby="findings-h">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="findings-h" className="font-display text-lg font-semibold">
            Findings
          </h2>
          {findings.length > 0 ? (
            <div role="group" aria-label="Filter by severity" className="inline-flex flex-wrap gap-0.5 rounded-xl border border-line bg-panel p-[3px]">
              {FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "inline-flex h-8 cursor-pointer items-center gap-[7px] rounded-[9px] px-3 text-[13.5px] font-semibold text-ink-2 hover:text-ink",
                    filter === key && "bg-panel-3 text-ink shadow-[inset_0_0_0_1px_var(--cs-line-2)]",
                  )}
                >
                  {key !== "all" ? <SeverityDot severity={key} /> : null}
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="panel">
          {findings.length === 0 ? (
            <p className="p-6 text-ink-2">{running ? "Findings appear when the agents finish." : "No findings. Nothing in this pull request needs a change."}</p>
          ) : shown.length === 0 ? (
            <p className="p-6 text-ink-2">No findings at this severity.</p>
          ) : (
            groupByFile(shown.map(({ finding }) => finding)).map((group) => (
              <div key={group.path} className="border-line [&+&]:border-t">
                <header className="flex items-center justify-between gap-3 border-b border-line bg-[rgb(5_6_11/0.45)] px-5 py-3">
                  <code className="min-w-0 font-mono text-[12.5px] [overflow-wrap:anywhere] text-ink">{group.path}</code>
                  <span className="flex-none text-[13px] font-semibold text-ink-3">
                    {group.findings.length} finding{group.findings.length === 1 ? "" : "s"}
                  </span>
                </header>
                <ul className="m-0 list-none p-0">
                  {shown
                    .filter(({ finding }) => finding.location.filePath === group.path)
                    .map(({ finding, index }) => {
                      const below = finding.confidence < threshold;
                      const expanded = open.has(index);
                      return (
                        <li key={index} className="border-b border-line last:border-b-0">
                          <button
                            type="button"
                            onClick={() => toggle(index)}
                            aria-expanded={expanded}
                            className={cn(
                              "grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 px-5 py-4 text-left hover:bg-cyan/[0.03]",
                              below && "opacity-55",
                            )}
                          >
                            <SeverityDot severity={finding.severity} />
                            <span className="font-bold">{finding.title}</span>
                            <ChevronDown className={cn("size-4 text-ink-3 transition-transform duration-150", expanded && "rotate-180")} aria-hidden="true" />
                            <span className="col-start-2 col-end-4 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-ink-3">
                              <span>{agentName(finding.agent)}</span>
                              {finding.alsoReportedBy?.length ? (
                                <span className="inline-flex flex-wrap items-center gap-1.5">
                                  Also flagged by
                                  {finding.alsoReportedBy.map((note) => (
                                    <span key={note.agent} className="rounded-full border border-cyan/30 bg-cyan/8 px-2 text-[12px] font-semibold text-ink-2">
                                      {agentName(note.agent)}
                                    </span>
                                  ))}
                                </span>
                              ) : null}
                              <span>
                                Line {finding.location.lineStart}
                                {finding.location.lineEnd > finding.location.lineStart ? `–${finding.location.lineEnd}` : ""}
                              </span>
                              <span className="tabular-nums">Confidence {finding.confidence.toFixed(2)}</span>
                              {finding.cweId ? <span>{finding.cweId}</span> : null}
                              {below ? (
                                <span>Not posted, below threshold</span>
                              ) : finding.suggestion?.state === "accepted" ? (
                                <span className="font-semibold text-pass">Fix committed</span>
                              ) : finding.suggestion?.state === "rejected" ? (
                                <span>Fix dismissed</span>
                              ) : finding.suggestion ? (
                                <span className="font-semibold text-pass">{finding.suggestion.kind === "deterministic" ? "Exact fix" : "Suggested fix"}</span>
                              ) : null}
                            </span>
                          </button>
                          {expanded ? (
                            <div className={cn("grid gap-3.5 px-5 pb-5 sm:pl-[42px]", below && "opacity-55")}>
                              <p className="max-w-[70ch] whitespace-pre-line text-ink-2">{finding.description}</p>
                              {finding.alsoReportedBy?.length ? (
                                <div className="grid gap-2.5 rounded-xl border border-line bg-panel-2/50 p-3.5">
                                  <p className="text-[13px] font-semibold text-ink-2">Other agents&apos; notes on the same issue</p>
                                  {finding.alsoReportedBy.map((note) => (
                                    <div key={note.agent} className="grid gap-1">
                                      <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                                        <SeverityDot severity={note.severity} />
                                        {agentName(note.agent)}: {note.title}
                                      </span>
                                      <p className="max-w-[70ch] whitespace-pre-line text-[13.5px] text-ink-2">{note.description}</p>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              <FixBlock finding={finding} />
                              <FixActions finding={finding} posted={!below} />
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)] gap-3.5" aria-labelledby="runs-h">
        <h2 id="runs-h" className="font-display text-lg font-semibold">
          Agent runs
        </h2>
        <ul className="panel m-0 list-none p-0">
          {AGENTS.map(({ key, agent, name }) => {
            const run = agentRuns.find((r) => r.agent === agent);
            const right = !run
              ? running
                ? <span className="text-cyan">Reading</span>
                : <span className="font-medium text-ink-3">Didn&apos;t run</span>
              : run.status === "succeeded"
                ? <span className="text-ink-2 tabular-nums">{run.latencyMs !== undefined ? `${(run.latencyMs / 1000).toFixed(1)} s` : "Done"}{run.llmProvider ? ` · ${run.llmProvider}` : ""}</span>
                : run.errorCode === "agent_not_configured"
                  ? <span className="font-medium text-ink-3">Not deployed</span>
                  : <span className="text-warn">{run.errorCode === "llm_quota_exhausted" ? "Deferred (quota)" : RUN_WORD[run.status]}</span>;
            return (
              <li key={key} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-[18px] py-[13px] text-sm font-semibold last:border-b-0">
                <span className="grid size-[30px] place-items-center rounded-[9px] border border-line bg-panel-2 text-ink-2" title={name}>
                  <AgentGlyph agent={key} className="size-4" />
                </span>
                <span>
                  {name}
                  {run?.findingsCount ? <span className="ml-1.5 font-medium text-ink-3">{run.findingsCount}</span> : null}
                </span>
                {right}
              </li>
            );
          })}
        </ul>
        {repositoryHref ? (
          <p className="text-[13.5px] text-ink-3">
            Choose agents in the repository&apos;s{" "}
            <Link href={repositoryHref} className="text-cyan hover:underline">
              Agents tab
            </Link>
            .
          </p>
        ) : null}
      </section>
    </div>
  );
}
