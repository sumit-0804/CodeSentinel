import { Suspense } from "react";
import type { Metadata } from "next";
import { Onboarding } from "@/components/app/onboarding";
import { PageHead, PageSkeleton } from "@/components/app/page-parts";
import { requireUser } from "@/lib/auth";
import { getRepositories } from "@/lib/repositories";
import { toShellUser } from "@/lib/shell-user";

export const metadata: Metadata = { title: "Overview" };

async function OverviewContent() {
  const [claims, repos] = await Promise.all([requireUser(), getRepositories()]);
  const user = toShellUser(claims);
  const firstName = user.displayName.includes("@") ? null : user.displayName.split(" ")[0];
  const connected = repos.ok && repos.repositories.length > 0;
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

export default function OverviewPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OverviewContent />
    </Suspense>
  );
}
