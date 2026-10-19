import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { AgentHealthNotice } from "@/components/app/agent-health-notice";
import { Onboarding } from "@/components/app/onboarding";
import { EmptyState, PageHead, PageSkeleton } from "@/components/app/page-parts";
import { RefreshWhileRunning } from "@/components/reviews/refresh-while-running";
import { ReviewTable } from "@/components/reviews/review-table";
import { Button } from "@/components/ui/button";
import { getAgentHealth } from "@/lib/agent-health";
import { requireUser } from "@/lib/auth";
import { getRepositories } from "@/lib/repositories";
import { overviewOf } from "@/lib/review-view";
import { getReviews } from "@/lib/reviews";
import { toShellUser } from "@/lib/shell-user";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };

const UNAVAILABLE = {
  unconfigured: "The API isn't configured for this dashboard (GATEWAY_URL).",
  unreachable: "Couldn't reach the API. Try again in a moment.",
  unauthorized: "The API didn't accept your session. Sign out and in again.",
  error: "The API answered with an error. Try again in a moment.",
} as const;

const RECENT = 5;

function Fact({ value, label, tone }: { value: number; label: string; tone?: "crit" | "cyan" }) {
  return (
    <div className="grid gap-1 px-5 py-4">
      <b
        className={cn(
          "font-display text-[28px] leading-none font-semibold tabular-nums",
          tone === "crit" && value > 0 && "text-crit [text-shadow:0_0_16px_rgb(255_77_115/0.5)]",
          tone === "cyan" && value > 0 && "text-cyan",
        )}
      >
        {value}
      </b>
      <span className="text-[13.5px] text-ink-2">{label}</span>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

async function OverviewContent() {
  const [claims, repos, reviews, health] = await Promise.all([requireUser(), getRepositories(), getReviews(true), getAgentHealth()]);
  const user = toShellUser(claims);
  const firstName = user.displayName.includes("@") ? null : user.displayName.split(" ")[0];
  const connected = repos.ok && repos.repositories.length > 0;

  // Setup is finished once any pull request has been reviewed; until then the checklist stays.
  if (!reviews.ok && connected) return <EmptyState title="The overview isn't available">{UNAVAILABLE[reviews.reason]}</EmptyState>;
  if (!reviews.ok || reviews.reviews.length === 0) {
    return (
      <>
        <PageHead
          title={firstName ? `Welcome, ${firstName}` : "Welcome"}
          sub={connected ? "One step left: open a pull request in a connected repository." : "Two steps left before your first review."}
        />
        <Onboarding signedInWith={user.signedInWith} connected={connected} />
      </>
    );
  }

  const overview = overviewOf(reviews.reviews);
  return (
    <>
      <PageHead
        title={overview.headline}
        actions={
          <Button asChild variant="outline">
            <Link href="/pull-requests">All pull requests</Link>
          </Button>
        }
      />
      <AgentHealthNotice health={health} />
      <div className="panel grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Fact value={overview.blocked} label="Blocked" tone="crit" />
        <Fact value={overview.running} label="Being reviewed" tone="cyan" />
        <Fact value={overview.thisWeek} label="Pull requests reviewed this week" />
      </div>
      {overview.attention.length > 0 ? (
        <Section title="Needs your attention">
          <ReviewTable reviews={overview.attention} />
        </Section>
      ) : null}
      <Section
        title="Recent reviews"
        aside={
          <Link href="/pull-requests" className="text-sm font-semibold text-cyan hover:underline">
            View all
          </Link>
        }
      >
        <ReviewTable reviews={reviews.reviews.slice(0, RECENT)} />
      </Section>
      {overview.running > 0 ? <RefreshWhileRunning intervalMs={5_000} /> : null}
    </>
  );
}

export default function OverviewPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OverviewContent />
    </Suspense>
  );
}
