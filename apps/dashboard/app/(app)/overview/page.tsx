import { Suspense } from "react";
import type { Metadata } from "next";
import { Onboarding } from "@/components/app/onboarding";
import { PageHead, PageSkeleton } from "@/components/app/page-parts";
import { requireUser } from "@/lib/auth";
import { toShellUser } from "@/lib/shell-user";

export const metadata: Metadata = { title: "Overview" };

async function OverviewContent() {
  const user = toShellUser(await requireUser());
  const firstName = user.displayName.includes("@") ? null : user.displayName.split(" ")[0];
  return (
    <>
      <PageHead
        title={firstName ? `Welcome, ${firstName}` : "Welcome"}
        sub="Two steps left before your first review."
      />
      <Onboarding signedInWith={user.signedInWith} />
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
