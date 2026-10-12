"use client";

import { useId } from "react";
import { Switch } from "@/components/ui/switch";

/**
 * The confidence a finding needs before it's posted. With `inherited`, the value can follow the
 * organization (null) or override it; without it, the value is always set (the organization default).
 */
export function ThresholdField({
  value,
  inherited,
  locked,
  onChange,
}: {
  value: number | null;
  inherited?: number;
  locked: boolean;
  onChange: (value: number | null) => void;
}) {
  const sliderId = useId();
  const shown = value ?? inherited ?? 0.8;
  const following = value === null;

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
      <p className="text-sm text-ink-2">
        Findings below this confidence stay in the dashboard and aren&apos;t posted to the pull request. A higher value means fewer, surer comments.
      </p>
    </div>
  );
}
