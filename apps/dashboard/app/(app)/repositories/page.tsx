import { Suspense } from "react";
import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { GithubBanner, isOnboardingOutcome } from "@/components/app/github-banner";
import { Onboarding } from "@/components/app/onboarding";
import { EmptyState, PageHead, PageSkeleton } from "@/components/app/page-parts";
import { RepositoryList } from "@/components/app/repository-list";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { getRepositories } from "@/lib/repositories";
import { toShellUser } from "@/lib/shell-user";

export const metadata: Metadata = { title: "Repositories" };

const UNAVAILABLE = {
  unconfigured: "The API isn't configured for this dashboard (GATEWAY_URL).",
  unreachable: "Couldn't reach the API. Try again in a moment.",
  unauthorized: "The API didn't accept your session. Sign out and in again.",
  error: "The API answered with an error. Try again in a moment.",
} as const;

/** The banner after coming back from GitHub (`?github=connected&repos=3`). */
async function Banner({ searchParams }: { searchParams: PageProps<"/repositories">["searchParams"] }) {
  const { github, repos } = await searchParams;
  if (!isOnboardingOutcome(github)) return null;
  const count = typeof repos === "string" && /^\d+$/.test(repos) ? Number(repos) : undefined;
  return <GithubBanner outcome={github} {...(count !== undefined ? { repositories: count } : {})} />;
}

async function RepositoriesContent() {
  const [user, result] = await Promise.all([requireUser(), getRepositories()]);
  if (!result.ok) {
    return <EmptyState title="Repositories aren't available">{UNAVAILABLE[result.reason]}</EmptyState>;
  }
  if (result.repositories.length === 0) {
    return <Onboarding signedInWith={toShellUser(user).signedInWith} />;
  }
  return <RepositoryList repositories={result.repositories} />;
}

export default function RepositoriesPage({ searchParams }: PageProps<"/repositories">) {
  return (
    <>
      <PageHead
        title="Repositories"
        sub="Pick what gets reviewed. Open a repository to choose which agents run on its pull requests."
        actions={
          // Opens GitHub's install page, where repositories are added or removed.
          <Button asChild variant="default">
            <a href="/onboarding/github/install">
              <ExternalLink aria-hidden="true" />
              Add repositories
            </a>
          </Button>
        }
      />
      <Suspense fallback={null}>
        <Banner searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<PageSkeleton />}>
        <RepositoriesContent />
      </Suspense>
    </>
  );
}
