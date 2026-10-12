import { cn } from "@/lib/utils";
import type { Verdict } from "@/lib/review-view";

const WORD: Record<Verdict, string> = { blocked: "Blocked", running: "Reviewing", partial: "Partial", passed: "Passed", failed: "Failed" };

const LOOK: Record<Verdict, string> = {
  blocked: "text-crit bg-crit/8",
  partial: "text-warn bg-warn/8",
  passed: "text-pass bg-pass/7",
  running: "text-cyan bg-cyan/7 border-dashed",
  failed: "text-ink-2 bg-panel-2",
};

export const verdictWord = (verdict: Verdict) => WORD[verdict];

/** The mockup's status pill: a glowing dot and one word, coloured by the verdict. */
export function VerdictPill({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={cn(
        "inline-flex h-[26px] items-center gap-[7px] rounded-full border border-current pr-[11px] pl-[9px] text-[12.5px] font-bold whitespace-nowrap",
        "before:size-[7px] before:rounded-full before:bg-current before:shadow-[0_0_8px_currentColor] before:content-['']",
        LOOK[verdict],
      )}
    >
      {WORD[verdict]}
    </span>
  );
}

const DOT = { critical: "bg-crit shadow-[0_0_8px_var(--cs-crit)]", warning: "bg-warn shadow-[0_0_8px_var(--cs-warn)]", info: "bg-info" } as const;

export function SeverityDot({ severity }: { severity: keyof typeof DOT }) {
  return <i aria-hidden="true" className={cn("inline-block size-2 flex-none rounded-full", DOT[severity])} />;
}

/** Counts by severity, the mockup's `.sev` row. */
export function SeverityCounts({ critical, warning, info }: { critical: number; warning: number; info: number }) {
  if (critical + warning + info === 0) return <span className="text-sm text-ink-3">None</span>;
  return (
    <span className="inline-flex gap-3.5 text-sm font-semibold tabular-nums" aria-label={`${critical} critical, ${warning} warning, ${info} info`}>
      {critical ? (
        <span className="inline-flex items-center gap-1.5">
          <SeverityDot severity="critical" />
          {critical}
        </span>
      ) : null}
      {warning ? (
        <span className="inline-flex items-center gap-1.5">
          <SeverityDot severity="warning" />
          {warning}
        </span>
      ) : null}
      {info ? (
        <span className="inline-flex items-center gap-1.5">
          <SeverityDot severity="info" />
          {info}
        </span>
      ) : null}
    </span>
  );
}
