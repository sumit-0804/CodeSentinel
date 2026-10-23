"use client";

import { useTransition } from "react";
import { signOut } from "@/app/(app)/settings/actions";
import { StepUpForm } from "@/components/auth/step-up";
import { Button } from "@/components/ui/button";

/** `/verify-code`: the authenticator code that finishes signing in, then a full navigation to `next`. */
export function VerifyCode({ next }: { next: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid gap-4">
      <StepUpForm
        inDialog={false}
        description="Your account has an authenticator app, so signing in needs a code from it too."
        onVerified={() => window.location.assign(next)}
      />
      <Button variant="ghost" className="justify-self-start" disabled={pending} onClick={() => startTransition(() => signOut("local"))}>
        Use a different account
      </Button>
    </div>
  );
}
