"use client";

import { useEffect, useState } from "react";
import { Loader } from "@/components/ui/loader";
import { elapsedLabel, progressLine, WAKE_HINT_AFTER_MS } from "@/lib/review-view";

/** A running review: agents answered so far and a live timer; the page refresh brings in new answers. */
export function ReviewProgress({ since, reported }: { since: string; reported: number }) {
  const start = new Date(since).getTime();
  // Null until the first tick, so the server and the first browser render agree.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  const elapsed = now === null ? 0 : now - start;

  return (
    <div className="grid gap-2 p-6">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold">
        <Loader label="Review running" className="text-cyan" />
        <span aria-live="polite">{progressLine(reported)}</span>
        <span className="font-mono text-[13px] font-medium text-ink-3 tabular-nums" title="Time so far">
          {elapsedLabel(elapsed)}
        </span>
      </p>
      <p className="text-sm text-ink-2">Findings appear when every agent is done; each one shows under Agent runs as it finishes.</p>
      {reported === 0 && elapsed > WAKE_HINT_AFTER_MS ? (
        <p className="text-sm text-ink-3">Agents on the free hosting plan sleep when idle and can take about a minute to wake up.</p>
      ) : null}
    </div>
  );
}
