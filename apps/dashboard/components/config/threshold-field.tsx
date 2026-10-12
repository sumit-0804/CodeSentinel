"use client";

import { useId } from "react";
import { SeverityDot } from "@/components/brand/verdict-pill";
import { Switch } from "@/components/ui/switch";
import { postedCount } from "@/lib/review-view";
import { cn } from "@/lib/utils";

/**
 * The confidence a finding needs before it's posted. With `inherited`, the value can follow the
 * organization (null) or override it; without it, the value is always set (the organization default).
 */
export function ThresholdField({
  value,
  inherited,
  locked,
  onChange,
  lastConfidences,
}: {
  value: number | null;
  inherited?: number;
  locked: boolean;
  onChange: (value: number | null) => void;
  /** The newest review's finding confidences, for a live "N of M would be posted" preview. */
  lastConfidences?: number[];
}) {
  const sliderId = useId();
  const shown = value ?? inherited ?? 0.8;
  const following = value === null;
  const posted = lastConfidences ? postedCount(lastConfidences, shown) : 0;

  return (
    <div className="grid gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={sliderId} className="font-semibold text-ink-2">
          Confidence threshold
        </label>
        <span className="font-display text-[30px] leading-none font-semibold text-cyan tabular-nums [text-shadow:0_0_18px_rgb(61_240_255/0.5)]">
          {shown.toFixed(2)}
        </span>
      </div>
      <input
        id={sliderId}
        type="range"
        min={0.5}
        max={1}
        step={0.05}
        value={shown}
        disabled={locked || following}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-6 w-full accent-cyan disabled:opacity-50"
      />
      {inherited !== undefined ? (
        <label className="flex flex-wrap items-center gap-3 text-sm text-ink-2">
          <Switch checked={following} disabled={locked} onCheckedChange={(on) => onChange(on ? null : inherited)} aria-label="Use the organization's threshold" />
          Use the organization&apos;s threshold ({inherited.toFixed(2)})
        </label>
      ) : null}
      {lastConfidences ? (
        <>
          <p className="text-sm text-ink-2" aria-live="polite">
            At this level,{" "}
            <b className="text-ink tabular-nums">
              {posted} of {lastConfidences.length}
            </b>{" "}
            findings from the last review would be posted to the pull request. The rest stay here.
          </p>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Confidence of each finding in the last review">
            {lastConfidences.map((confidence, i) => {
              const out = confidence < shown - 1e-9;
              return (
                <li
                  key={i}
                  className={cn(
                    "inline-flex h-[30px] items-center gap-[7px] rounded-[9px] border border-line px-2.5 text-[13px] font-semibold tabular-nums",
                    out && "line-through opacity-40",
                  )}
                >
                  <SeverityDot severity={confidence >= 0.9 ? "critical" : confidence >= 0.75 ? "warning" : "info"} />
                  {confidence.toFixed(2)}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="text-sm text-ink-2">
          Findings below this confidence stay in the dashboard and aren&apos;t posted to the pull request. A higher value means fewer, surer comments.
        </p>
      )}
    </div>
  );
}
