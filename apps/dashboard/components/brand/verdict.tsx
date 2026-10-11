import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { AGENTS, AgentGlyph } from "./agents";

/** Each agent's worst result: critical, warning, info, clean, not run, still reading. */
export type LaneState = "c" | "w" | "i" | "ok" | "off" | "run";

const LANE_WORD: Record<LaneState, string> = {
  c: "critical",
  w: "warning",
  i: "info",
  ok: "clean",
  off: "not run",
  run: "reading",
};

const lanesLabel = (lanes: readonly LaneState[]) =>
  lanes.map((state, i) => `${AGENTS[i].name}: ${LANE_WORD[state]}`).join(", ");

const BAR: Record<LaneState, string> = {
  c: "bg-crit shadow-[0_0_10px_rgb(255_77_115/0.7)]",
  w: "bg-warn shadow-[0_0_10px_rgb(255_184_77/0.55)]",
  i: "bg-info",
  ok: "bg-pass shadow-[0_0_10px_rgb(57_245_166/0.5)]",
  off: "bg-transparent shadow-[inset_0_0_0_1.5px_var(--cs-line-2)]",
  run: "bg-cyan shadow-[0_0_10px_rgb(61_240_255/0.7)] animate-[cs-pulse_1.3s_ease-in-out_infinite]",
};

export function Lanes({ lanes }: { lanes: readonly LaneState[] }) {
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={lanesLabel(lanes)}>
      {lanes.map((state, i) => (
        <i key={AGENTS[i].key} className={cn("block h-[22px] w-1.5 rounded", BAR[state])} />
      ))}
    </span>
  );
}

const FILL: Record<LaneState, string> = {
  c: "bg-[linear-gradient(180deg,#ff8aa4,var(--cs-crit))] shadow-[0_0_28px_rgb(255_77_115/0.8)]",
  w: "bg-[linear-gradient(180deg,#ffd38f,var(--cs-warn))] shadow-[0_0_24px_rgb(255_184_77/0.6)]",
  i: "bg-[linear-gradient(180deg,#b9bedb,var(--cs-info))]",
  ok: "bg-[linear-gradient(180deg,#9dffd3,var(--cs-pass))] shadow-[0_0_24px_rgb(57_245_166/0.55)]",
  off: "bg-none",
  run: "bg-[linear-gradient(180deg,#a5f8ff,var(--cs-cyan))] opacity-80 animate-[cs-pulse_1.3s_ease-in-out_infinite]",
};

const GLYPH: Partial<Record<LaneState, string>> = {
  c: "text-crit border-crit/40",
  ok: "text-pass border-pass/35",
  w: "text-warn",
};

/** Tall bars with agent glyphs; `rise` grows them one after another (the sign-in hero). */
export function Gauge({
  lanes,
  size = "lg",
  rise,
  className,
}: {
  lanes: readonly LaneState[];
  size?: "sm" | "lg";
  rise?: { startMs: number; stepMs: number };
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={lanesLabel(lanes)}
      className={cn(
        "grid w-full grid-cols-5",
        size === "lg" ? "max-w-[360px] gap-2.5" : "max-w-[260px] gap-2",
        className,
      )}
    >
      {lanes.map((state, i) => {
        const style: CSSProperties | undefined = rise
          ? { animation: `cs-rise .7s cubic-bezier(.2,.8,.2,1) ${rise.startMs + i * rise.stepMs}ms both` }
          : undefined;
        return (
          <div key={AGENTS[i].key} className="grid justify-items-center gap-2.5">
            <div
              className={cn(
                "relative w-full overflow-hidden border border-line bg-white/[0.04]",
                size === "lg" ? "h-[120px] rounded-xl" : "h-[68px] rounded-[9px]",
                state === "off" && "border-dashed",
              )}
            >
              <span className={cn("absolute inset-0 origin-bottom", FILL[state])} style={style} />
            </div>
            <span
              title={AGENTS[i].name}
              className={cn("grid size-[30px] place-items-center rounded-[9px] border border-line bg-panel-2 text-ink-2", GLYPH[state])}
            >
              <AgentGlyph agent={AGENTS[i].key} className="size-4" />
            </span>
          </div>
        );
      })}
    </div>
  );
}
