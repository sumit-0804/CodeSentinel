import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StepUpContinue } from "@/components/auth/step-up-continue";
import { PageHead } from "@/components/app/page-parts";
import { requireUser } from "@/lib/auth";
import { needsStepUp } from "@/lib/mfa";
import { safeNextPath } from "@/lib/safe-next-path";

export const metadata: Metadata = { title: "Enter your code" };

async function StepUpBody({ searchParams }: { searchParams: PageProps<"/step-up">["searchParams"] }) {
  await requireUser();
  const { next } = await searchParams;
  const target = safeNextPath(next, "/repositories");
  if (!(await needsStepUp())) redirect(target);
  return (
    <div className="panel max-w-[460px] p-6">
      <StepUpContinue next={target} />
    </div>
  );
}

/** Asks for an authenticator code before a flow that changes repositories, such as installing the GitHub App. */
export default function StepUpPage({ searchParams }: PageProps<"/step-up">) {
  return (
    <div className="grid gap-[30px]">
      <PageHead title="Confirm it's you" sub="Connecting repositories changes what Code Sentinel can read, so it needs a code from your authenticator app." />
      <Suspense fallback={<div className="h-[260px] max-w-[460px] animate-pulse rounded-2xl bg-panel" />}>
        <StepUpBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
