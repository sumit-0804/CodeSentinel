import type { CSSProperties, ReactNode } from "react";
import { Gauge } from "@/components/brand/verdict";
import { BackgroundBeams } from "@/components/ui/background-beams";
import { cn } from "@/lib/utils";
import { VerdictReveal } from "./verdict-reveal";

// The one orchestrated moment: scan the diff, light the hits, raise the lanes, land the verdict.
const light = (delayMs: number): CSSProperties => ({ animation: `cs-light .4s ${delayMs}ms both` });

function Line({ n, hit, delayMs, children }: { n: number; hit?: boolean; delayMs?: number; children: ReactNode }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[40px_18px_minmax(0,1fr)] pr-3.5 whitespace-pre text-ink-2",
        hit && "bg-crit/12 text-ink shadow-[inset_3px_0_0_var(--cs-crit)]",
      )}
      style={hit && delayMs !== undefined ? light(delayMs) : undefined}
    >
      <span className="pr-2.5 text-right text-ink-3">{n}</span>
      <span className={cn(hit && "text-crit [text-shadow:0_0_8px_var(--cs-crit)]")}>{hit ? "●" : ""}</span>
      <span className="overflow-hidden text-ellipsis">{children}</span>
    </div>
  );
}

function Note({ delayMs, children }: { delayMs: number; children: ReactNode }) {
  return (
    <span className="block pb-1.5 pl-[58px] pr-3.5 font-sans text-[12.5px] leading-normal font-semibold text-[#ff9db3]" style={light(delayMs)}>
      {children}
    </span>
  );
}

export function AuthHero() {
  return (
    <aside
      aria-label="An example review"
      className="relative hidden flex-col justify-center gap-[30px] overflow-hidden border-l border-line bg-[linear-gradient(180deg,rgb(15_17_28/0.6),rgb(9_10_18/0.9))] px-[clamp(16px,5vw,72px)] py-9 min-[821px]:flex"
    >
      <BackgroundBeams className="opacity-60" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgb(61_240_255/0.05)_1px,transparent_1px),linear-gradient(90deg,rgb(61_240_255/0.05)_1px,transparent_1px)] bg-size-[32px_32px] mask-[radial-gradient(ellipse_at_60%_40%,#000_30%,transparent_75%)]"
      />

      <div className="relative">
        <div className="font-mono text-xs text-ink-3">sumit-0804/code-sentinel-playground #4</div>
        <h2 className="mt-1.5 text-[19px] leading-snug font-bold">Add payment search and tax</h2>
      </div>

      <div
        aria-hidden="true"
        className="relative max-w-[560px] overflow-hidden rounded-[14px] border border-line bg-[rgb(5_6_11/0.7)] py-3 font-mono text-xs leading-[1.9]"
      >
        <span
          className="pointer-events-none absolute inset-x-0 top-0 h-10 border-b border-cyan/60 bg-[linear-gradient(180deg,transparent,rgb(61_240_255/0.22),transparent)] opacity-0"
          style={{ animation: "cs-beam 1.3s cubic-bezier(.4,0,.2,1) both" }}
        />
        <Line n={2}>import sqlite3</Line>
        <Line n={3} hit delayMs={550}>AWS_ACCESS_KEY_ID = &quot;AKIAIOSFODNN7EXAMPLE&quot;</Line>
        <Note delayMs={550}>Security: AWS access key in source</Note>
        <Line n={10}>def search_payments(conn, customer):</Line>
        <Line n={11}>    cur = conn.cursor()</Line>
        <Line n={12} hit delayMs={950}>    cur.execute(f&quot;SELECT … &apos;{"{customer}"}&apos;&quot;)</Line>
        <Note delayMs={950}>Security: SQL built from user input</Note>
      </div>

      <Gauge className="relative" lanes={["c", "i", "off", "off", "off"]} rise={{ startMs: 1300, stepMs: 150 }} />

      <p
        className="relative font-display text-[clamp(46px,5.8vw,80px)] leading-[0.95] font-bold tracking-[-0.04em] text-ink [text-shadow:0_0_34px_rgb(255_77_115/0.55)]"
        style={{ animation: "cs-land .7s 2.3s cubic-bezier(.2,.8,.2,1) both" }}
      >
        <VerdictReveal text="Blocked." delayMs={2300} />
        <small className="mt-4 block max-w-[42ch] font-sans text-base leading-[1.55] font-medium tracking-normal text-ink-2 [text-shadow:none]">
          Two critical findings stop this merge. The fix is already waiting on the pull request.
        </small>
      </p>
    </aside>
  );
}
