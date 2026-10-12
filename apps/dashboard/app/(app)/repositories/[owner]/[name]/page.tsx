import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState, PageSkeleton } from "@/components/app/page-parts";
import { RepositorySettings, type RepositoryTab } from "@/components/config/repository-settings";
import { getRepositoryPageData } from "@/lib/repository-config";

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
  const initialTab: RepositoryTab = tab === "advanced" ? "advanced" : "agents";
  // Keyed by repository so moving between repositories starts a fresh draft.
  return <RepositorySettings key={data.config.repositoryId} config={data.config} defaults={data.defaults} isAdmin={data.isAdmin} initialTab={initialTab} />;
}

export default function RepositoryPage(props: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RepositoryContent {...props} />
    </Suspense>
  );
}
