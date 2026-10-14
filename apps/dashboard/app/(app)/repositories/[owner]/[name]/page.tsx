import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState, PageSkeleton } from "@/components/app/page-parts";
import { RepositorySettings, type RepositoryTab } from "@/components/config/repository-settings";
import { getRepositoryPageData } from "@/lib/repository-config";
import { getOpenPullRequests, getReview, getReviews } from "@/lib/reviews";

type Props = PageProps<"/repositories/[owner]/[name]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params;
  return { title: decodeURIComponent(name) };
}

const UNAVAILABLE = {
  unconfigured: "The API isn't configured for this dashboard (GATEWAY_URL).",
  unreachable: "Couldn't reach the API. Try again in a moment.",
  unauthorized: "The API didn't accept your session. Sign out and in again.",
  error: "The API answered with an error. Try again in a moment.",
} as const;

async function RepositoryContent({ params, searchParams }: Props) {
  const [{ owner, name }, { tab }] = await Promise.all([params, searchParams]);
  const data = await getRepositoryPageData(`${decodeURIComponent(owner)}/${decodeURIComponent(name)}`);
  if (!data.ok) {
    if (data.reason === "not_found") notFound();
    return <EmptyState title="This repository isn't available">{UNAVAILABLE[data.reason]}</EmptyState>;
  }
  const initialTab: RepositoryTab = tab === "advanced" || tab === "pull-requests" ? tab : "agents";
  const [reviews, open] = await Promise.all([getReviews(true, data.config.repositoryId), getOpenPullRequests(data.config.repositoryId)]);
  // The newest review's confidences drive the threshold preview; without reviews it's simply left out.
  const newest = reviews.ok ? reviews.reviews.find((review) => review.status !== "queued" && review.status !== "running") : undefined;
  const last = newest ? await getReview(newest.reviewId) : undefined;
  const lastConfidences = last?.ok ? last.review.findings.map((finding) => finding.confidence) : undefined;
  const openPullRequests = open.ok
    ? { ok: true as const, pulls: open.pulls }
    : { ok: false as const, message: open.code === "github_unavailable" ? "GitHub didn't answer. Reload in a moment to see open pull requests." : UNAVAILABLE[open.reason] };

  // Keyed by repository so moving between repositories starts a fresh draft.
  return (
    <RepositorySettings
      key={data.config.repositoryId}
      config={data.config}
      defaults={data.defaults}
      isAdmin={data.isAdmin}
      initialTab={initialTab}
      openPullRequests={openPullRequests}
      {...(lastConfidences ? { lastConfidences } : {})}
    />
  );
}

export default function RepositoryPage(props: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RepositoryContent {...props} />
    </Suspense>
  );
}
