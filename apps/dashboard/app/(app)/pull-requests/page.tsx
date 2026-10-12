import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHead } from "@/components/app/page-parts";
import { ReviewTable } from "@/components/reviews/review-table";
import { Button } from "@/components/ui/button";
import { getReviews } from "@/lib/reviews";

export const metadata: Metadata = { title: "Pull requests" };

const UNAVAILABLE = {
  unconfigured: "The API isn't configured for this dashboard (GATEWAY_URL).",
  unreachable: "Couldn't reach the API. Try again in a moment.",
  unauthorized: "The API didn't accept your session. Sign out and in again.",
  error: "The API answered with an error. Try again in a moment.",
} as const;

async function PullRequestsContent() {
  const result = await getReviews(true);
  if (!result.ok) return <EmptyState title="Pull requests aren't available">{UNAVAILABLE[result.reason]}</EmptyState>;
  if (result.reviews.length === 0) {
    return (
      <EmptyState
        title="No pull requests reviewed yet"
        actions={
          <Button asChild>
            <Link href="/repositories">Go to repositories</Link>
          </Button>
        }
      >
        Reviews appear here once a repository is connected and someone opens or updates a pull request in it.
      </EmptyState>
    );
  }
  return <ReviewTable reviews={result.reviews} filters />;
}

export default function PullRequestsPage() {
  return (
    <>
      <PageHead title="Pull requests" sub="Every pull request Code Sentinel reviewed, newest first." />
      <Suspense fallback={<div className="h-[220px] animate-pulse rounded-2xl bg-panel" />}>
        <PullRequestsContent />
      </Suspense>
    </>
  );
}
