"use client";

import { StepUpForm } from "@/components/auth/step-up";

/** The `/step-up` page's form: after the code, a full navigation, because `next` may be a route handler that leaves for GitHub. */
export function StepUpContinue({ next }: { next: string }) {
  return <StepUpForm inDialog={false} onVerified={() => window.location.assign(next)} />;
}
