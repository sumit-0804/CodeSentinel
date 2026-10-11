"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { signInWithProvider } from "@/app/(auth)/actions";
import { GitHubIcon, GoogleIcon } from "@/components/brand/provider-icons";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";

function ProviderButton({ provider, children }: { provider: "github" | "google"; children: ReactNode }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("provider") === provider;
  return (
    <Button type="submit" name="provider" value={provider} size="lg" className="w-full" disabled={pending}>
      {mine ? <Loader label="Opening the provider" className="text-cyan" /> : children}
    </Button>
  );
}

/** `nextField` is a hidden `next` input streamed in by the page, so the buttons render before it. */
export function OAuthButtons({ verb, nextField }: { verb: "Continue" | "Sign up"; nextField?: ReactNode }) {
  return (
    <form action={signInWithProvider} className="grid gap-3">
      {nextField}
      <ProviderButton provider="github">
        <GitHubIcon />
        {verb} with GitHub
      </ProviderButton>
      <ProviderButton provider="google">
        <GoogleIcon />
        {verb} with Google
      </ProviderButton>
    </form>
  );
}
