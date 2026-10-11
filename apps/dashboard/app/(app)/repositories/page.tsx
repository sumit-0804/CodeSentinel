import { Suspense } from "react";
import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { Onboarding } from "@/components/app/onboarding";
import { PageHead, PageSkeleton } from "@/components/app/page-parts";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { toShellUser } from "@/lib/shell-user";

export const metadata: Metadata = { title: "Repositories" };

async function RepositoriesContent() {
  const user = toShellUser(await requireUser());
  return <Onboarding signedInWith={user.signedInWith} />;
}

export default function RepositoriesPage() {
  return (
    <>
      <PageHead
        title="Repositories"
        sub="Pick what gets reviewed. Open a repository to choose which agents run on its pull requests."
        actions={
          <Button variant="default" disabled title="Arrives with GitHub onboarding">
            <ExternalLink aria-hidden="true" />
            Add repositories
          </Button>
        }
      />
      <Suspense fallback={<PageSkeleton />}>
        <RepositoriesContent />
      </Suspense>
    </>
  );
}
