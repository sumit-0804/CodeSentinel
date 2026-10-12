"use client";

import type { AgentKind, AgentMode } from "@code-sentinel/contracts";
import { RadioGroup } from "radix-ui";
import { cn } from "cn";
import { AGENTS, AgentGlyph } from "@/components/brand/agents";
import type { AgentModes } from "@/lib/config-draft";

const MODE_WORD: Record<AgentMode, string> = { off: "Off", comment: "Comment", block: "Block merge" };

const GLYPH: Record<AgentMode, string> = {
  off: "border-line-2 text-ink-2",
  comment: "border-cyan/40 text-cyan shadow-[0_0_20px_-6px_rgb(61_240_255/0.8)]",
  block: "border-crit/45 text-crit shadow-[0_0_20px_-6px_rgb(255_77_115/0.8)]",
};

const CHOSEN: Record<AgentMode, string> = {
  off: "data-[state=checked]:bg-panel-3 data-[state=checked]:text-ink",
  comment: "data-[state=checked]:bg-cyan/14 data-[state=checked]:text-cyan data-[state=checked]:shadow-[inset_0_0_0_1px_rgb(61_240_255/0.4)]",
  block: "data-[state=checked]:bg-crit/14 data-[state=checked]:text-crit data-[state=checked]:shadow-[inset_0_0_0_1px_rgb(255_77_115/0.45)]",
};

/** One row per agent with Off / Comment / Block merge; `locked` shows the modes without letting them change. */
export function AgentModeRows({
  modes,
  locked,
  onChange,
}: {
  modes: AgentModes;
  locked: boolean;
  onChange: (agent: AgentKind, mode: AgentMode) => void;
}) {
  return (
    <>
      <ul className="m-0 list-none p-0">
        {AGENTS.map(({ key, agent, name, what, live }) => {
          const mode = modes[agent];
          return (
            <li
              key={key}
              className="grid grid-cols-[46px_minmax(0,1fr)] items-center gap-x-[18px] gap-y-3 border-b border-line px-5 py-[18px] last:border-b-0 sm:grid-cols-[46px_minmax(0,1fr)_auto]"
            >
              <span className={cn("grid size-[46px] place-items-center rounded-[13px] border bg-panel-3 transition-all duration-150", GLYPH[mode])}>
                <AgentGlyph agent={key} className="size-[22px]" />
              </span>
              <div className={cn("min-w-0", mode === "off" && "opacity-60")}>
                <b className="flex flex-wrap items-center gap-2 text-base font-bold">
                  {name}
                  {live ? null : (
                    <span className="rounded-full border border-warn/35 px-2 text-[11.5px] font-semibold text-warn">Not deployed yet</span>
                  )}
                </b>
                <p className="text-sm text-ink-2">{what}</p>
              </div>
              <RadioGroup.Root
                value={mode}
                onValueChange={(value) => onChange(agent, value as AgentMode)}
                disabled={locked}
                aria-label={`${name} on pull requests`}
                className="col-span-2 inline-flex justify-self-start rounded-xl border border-line bg-panel p-[3px] sm:col-span-1"
              >
                {(["off", "comment", "block"] as const).map((value) => (
                  <RadioGroup.Item
                    key={value}
                    value={value}
                    className={cn(
                      "h-8 cursor-pointer rounded-[9px] px-3 text-[13px] font-bold whitespace-nowrap text-ink-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-cyan/60",
                      "disabled:cursor-not-allowed disabled:hover:text-ink-2",
                      CHOSEN[value],
                    )}
                  >
                    {MODE_WORD[value]}
                  </RadioGroup.Item>
                ))}
              </RadioGroup.Root>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-x-[22px] gap-y-1.5 border-t border-line bg-[rgb(5_6_11/0.35)] px-5 py-3.5 text-[13.5px] text-ink-2">
        <span>
          <b className="text-ink">Comment</b> posts findings on the pull request.
        </span>
        <span>
          <b className="text-ink">Block merge</b> also fails the GitHub check when it finds something critical.
        </span>
      </div>
    </>
  );
}
