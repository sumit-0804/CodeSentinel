import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHead } from "@/components/app/page-parts";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Pull requests" };

async function PullRequestsContent() {
  await requireUser();
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
