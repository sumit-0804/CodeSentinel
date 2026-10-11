import { Suspense } from "react";
import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/auth-forms";
import { AuthHeading } from "@/components/auth/form-parts";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Choose a new password" };

// Reached from the reset email, which signs the user in with a recovery session first.
async function ResetPasswordGate() {
  await requireUser();
  return <ResetPasswordForm />;
}

export default function ResetPasswordPage() {
  return (
    <>
      <AuthHeading title="Choose a new password" />
      <Suspense fallback={<div className="h-[230px] animate-pulse rounded-xl bg-panel" />}>
        <ResetPasswordGate />
      </Suspense>
    </>
  );
}
