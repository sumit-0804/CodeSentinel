import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { EmptyState, PageSkeleton } from "@/components/app/page-parts";
import { Gauge } from "@/components/brand/verdict";
import { VerdictPill } from "@/components/brand/verdict-pill";
import { ReviewReport } from "@/components/reviews/review-report";
import { lanesOf, timeAgo, verdictOf, verdictSentence } from "@/lib/review-view";
import { getReview } from "@/lib/reviews";

export const metadata: Metadata = { title: "Pull request" };

const UNAVAILABLE = {
  unconfigured: "The API isn't configured for this dashboard (GATEWAY_URL).",
  unreachable: "Couldn't reach the API. Try again in a moment.",
  unauthorized: "The API didn't accept your session. Sign out and in again.",
  error: "The API answered with an error. Try again in a moment.",
} as const;

async function ReviewContent({ params }: PageProps<"/pull-requests/[reviewId]">) {
  const { reviewId } = await params;
  const result = await getReview(reviewId);
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return <EmptyState title="This review isn't available">{UNAVAILABLE[result.reason]}</EmptyState>;
  }
  const review = result.review;
  const verdict = verdictOf(review);
  const threshold = review.confidenceThreshold ?? 0.8;
  const repoName = review.repositoryFullName.split("/")[1] ?? review.repositoryFullName;
  const number = review.pullRequestNumber;
  const running = verdict === "running";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-[30px]">
      <div>
        <nav aria-label="Breadcrumb" className="mb-2.5 flex flex-wrap items-center gap-1.5 text-[13.5px] text-ink-3">
          <Link href="/pull-requests" className="font-semibold text-ink-2 hover:text-cyan">
            Pull requests
          </Link>
          <span aria-hidden="true">/</span>
          <code aria-current="page" className="font-mono text-xs">
            {repoName}
            {number !== undefined ? ` #${number}` : ""}
          </code>
        </nav>
        <div className="grid grid-cols-[minmax(0,1fr)] items-end gap-x-12 gap-y-6 md:grid-cols-[minmax(0,1fr)_minmax(220px,290px)]">
          <div className="min-w-0">
            <h1 className="text-display text-[clamp(24px,2.8vw,32px)] [overflow-wrap:anywhere]">{review.pullRequestTitle ?? `Pull request #${number ?? "?"}`}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-3.5 gap-y-2.5 text-base font-semibold">
              <VerdictPill verdict={verdict} />
              <span>{verdictSentence(verdict, review.summary)}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[13.5px] text-ink-2">
              {review.headSha ? (
                <span>
                  Commit <code className="font-mono font-bold text-ink">{review.headSha.slice(0, 7)}</code>
                </span>
              ) : null}
              <span>
                Reviewed <b className="text-ink">{timeAgo(review.createdAt)}</b>
              </span>
              <span>
                Threshold <b className="text-ink tabular-nums">{threshold.toFixed(2)}</b>
              </span>
              {number !== undefined ? (
                <a
                  href={`https://github.com/${review.repositoryFullName}/pull/${number}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-cyan hover:underline"
                >
                  View on GitHub
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          </div>
          <Gauge lanes={lanesOf(review.agentResults)} size="sm" />
        </div>
      </div>
      <ReviewReport
        findings={review.findings}
        agentRuns={review.agentRuns}
        threshold={threshold}
        running={running}
        repositoryHref={`/repositories/${review.repositoryFullName}`}
      />
    </div>
  );
}

export default function ReviewPage(props: PageProps<"/pull-requests/[reviewId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReviewContent {...props} />
    </Suspense>
  );
}
