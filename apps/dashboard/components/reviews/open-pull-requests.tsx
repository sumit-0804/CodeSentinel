"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { PullRequestListItem } from "@code-sentinel/contracts";
import { Lanes } from "@/components/brand/verdict";
import { VerdictPill } from "@/components/brand/verdict-pill";
import { RerunButton } from "@/components/reviews/rerun-button";
import { exactTime, lanesOf, timeAgo, verdictOf } from "@/lib/review-view";

/** The repository's open pull requests from GitHub: the newest verdict, and a button to review now or again. */
export function OpenPullRequests({ repositoryId, pulls }: { repositoryId: string; pulls: PullRequestListItem[] }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-[12.5px] font-semibold text-ink-3">
            <th className="border-b border-line px-5 py-3">Pull request</th>
            <th className="border-b border-line px-5 py-3">Agents</th>
            <th className="border-b border-line px-5 py-3">Verdict</th>
            <th className="border-b border-line px-5 py-3 text-right">Review</th>
          </tr>
        </thead>
        <tbody>
          {pulls.map((pull) => {
            const review = pull.latestReview;
            return (
              <tr key={pull.number} className="border-b border-line last:border-b-0">
                <td className="px-5 py-3.5">
                  <div className="grid min-w-[220px] gap-0.5">
                    {review ? (
                      <Link href={`/pull-requests/${review.reviewId}`} className="font-bold [overflow-wrap:anywhere] hover:text-cyan focus-visible:text-cyan">
                        {pull.title}
                      </Link>
                    ) : (
                      <b className="font-bold [overflow-wrap:anywhere]">{pull.title}</b>
                    )}
                    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-3">
                      <code className="font-mono">#{pull.number}</code>
                      {pull.author ? <span>by {pull.author}</span> : null}
                      <span>
                        into <code className="font-mono">{pull.baseRef}</code>
                      </span>
                      {pull.draft ? <span className="rounded-md border border-line-2 px-1.5 font-semibold">Draft</span> : null}
                      <a href={pull.htmlUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-cyan" aria-label={`Open #${pull.number} on GitHub`}>
                        GitHub
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    </span>
                  </div>
                </td>
                <td className="px-5 py-3.5">{review ? <Lanes lanes={lanesOf(review.agentResults)} /> : null}</td>
                <td className="px-5 py-3.5">
                  {review ? (
                    <div className="grid justify-items-start gap-1">
                      <VerdictPill verdict={verdictOf(review)} />
                      <time dateTime={review.createdAt} title={exactTime(review.createdAt)} className="text-xs text-ink-3" suppressHydrationWarning>
                        {review.headSha && review.headSha !== pull.headSha ? "Older commit · " : ""}
                        {timeAgo(review.createdAt)}
                      </time>
                    </div>
                  ) : (
                    <span className="text-sm text-ink-3">Not reviewed yet</span>
                  )}
                </td>
                <td className="px-5 py-3.5 text-right">
                  {pull.reviewable ? (
                    <RerunButton repositoryId={repositoryId} pullRequestNumber={pull.number} label={review ? "Re-run" : "Review now"} size="sm" />
                  ) : (
                    <span className="text-[13px] text-ink-3">Base branch not reviewed</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
