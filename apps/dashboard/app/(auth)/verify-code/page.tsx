import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading } from "@/components/auth/form-parts";
import { VerifyCode } from "@/components/auth/verify-code";
import { requireUser } from "@/lib/auth";
import { needsSignInCode } from "@/lib/mfa";
import { safeNextPath } from "@/lib/safe-next-path";

export const metadata: Metadata = { title: "Enter your code" };

async function VerifyCodeBody({ searchParams }: { searchParams: PageProps<"/verify-code">["searchParams"] }) {
  await requireUser();
  const { next } = await searchParams;
  const target = safeNextPath(next);
  if (!(await needsSignInCode())) redirect(target);
  return <VerifyCode next={target} />;
}

/** Signing in with a password or OAuth isn't enough once the account has an authenticator app. */
export default function VerifyCodePage({ searchParams }: PageProps<"/verify-code">) {
  return (
    <>
      <AuthHeading title="One more step" lead="Enter the 6-digit code from your authenticator app." />
      <Suspense fallback={<div className="h-[220px] animate-pulse rounded-2xl bg-panel" />}>
        <VerifyCodeBody searchParams={searchParams} />
      </Suspense>
    </>
  );
}
