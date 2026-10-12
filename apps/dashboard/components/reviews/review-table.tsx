"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ReviewListItem } from "@code-sentinel/contracts";
import { Lanes } from "@/components/brand/verdict";
import { SeverityCounts, VerdictPill, verdictWord } from "@/components/brand/verdict-pill";
import { cn } from "@/lib/utils";
import { lanesOf, timeAgo, verdictOf, type Verdict } from "@/lib/review-view";

const FILTERS: ("all" | Verdict)[] = ["all", "blocked", "running", "partial", "passed"];

/** Pull requests with their verdict lanes; each title opens the PR page. `filters` adds the verdict chips. */
export function ReviewTable({ reviews, filters = false, showRepository = true }: { reviews: ReviewListItem[]; filters?: boolean; showRepository?: boolean }) {
  const [filter, setFilter] = useState<"all" | Verdict>("all");
  const rows = useMemo(() => reviews.map((review) => ({ review, verdict: verdictOf(review) })), [reviews]);
  const shown = filter === "all" ? rows : rows.filter((row) => row.verdict === filter);
  const count = (f: "all" | Verdict) => (f === "all" ? rows.length : rows.filter((row) => row.verdict === f).length);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5">
      {filters ? (
        <div role="group" aria-label="Filter by verdict" className="inline-flex flex-wrap gap-0.5 justify-self-start rounded-xl border border-line bg-panel p-[3px]">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "inline-flex h-8 cursor-pointer items-center gap-[7px] rounded-[9px] px-3 text-[13.5px] font-semibold text-ink-2 hover:text-ink",
                filter === f && "bg-panel-3 text-ink shadow-[inset_0_0_0_1px_var(--cs-line-2)]",
              )}
            >
              {f === "all" ? "All" : verdictWord(f)}
              <span className="font-semibold text-ink-3 tabular-nums">{count(f)}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="panel overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-[12.5px] font-semibold text-ink-3">
              <th className="border-b border-line px-5 py-3">Pull request</th>
              <th className="border-b border-line px-5 py-3">Agents</th>
              <th className="border-b border-line px-5 py-3">Verdict</th>
              <th className="border-b border-line px-5 py-3">Findings</th>
              <th className="border-b border-line px-5 py-3 text-right">Reviewed</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ review, verdict }) => (
              <tr key={review.reviewId} className="border-b border-line last:border-b-0 hover:bg-cyan/[0.03]">
                <td className="px-5 py-3.5">
                  <div className="grid min-w-[220px] gap-0.5">
                    <Link href={`/pull-requests/${review.reviewId}`} className="font-bold hover:text-cyan focus-visible:text-cyan">
                      {review.pullRequestTitle ?? `Pull request #${review.pullRequestNumber ?? "?"}`}
                    </Link>
                    <code className="font-mono text-xs text-ink-3">
                      {showRepository ? review.repositoryFullName.split("/")[1] : ""}
                      {review.pullRequestNumber !== undefined ? ` #${review.pullRequestNumber}` : ""}
                    </code>
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  <Lanes lanes={lanesOf(review.agentResults)} />
                </td>
                <td className="px-5 py-3.5">
                  <VerdictPill verdict={verdict} />
                </td>
                <td className="px-5 py-3.5">
                  <SeverityCounts critical={review.summary.criticalCount} warning={review.summary.warningCount} info={review.summary.infoCount} />
                </td>
                <td className="px-5 py-3.5 text-right text-sm whitespace-nowrap text-ink-3 tabular-nums">
                  <time dateTime={review.createdAt} title={new Date(review.createdAt).toLocaleString()}>
                    {timeAgo(review.createdAt)}
                  </time>
                </td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-sm text-ink-2">
                  No pull requests match. Clear the filter to see every reviewed pull request.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
