import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthHeading } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Sign-in problem" };

const REASONS: Record<string, { title: string; body: string }> = {
  link: {
    title: "This link didn't work",
    body: "It has expired or was already used. Ask for a new email from the sign-in page.",
  },
  confirmed: {
    title: "Your email is confirmed",
    body: "The link opened in a different browser from the one you signed up in, so sign in here to continue.",
  },
  oauth: {
    title: "Sign-in was cancelled",
    body: "The provider didn't confirm who you are, or you closed the window. Try again, or use email instead.",
  },
  identity_taken: {
    title: "That account is already in use",
    body: "It's linked to another Code Sentinel user. Sign in with it there, or link a different account.",
  },
  provider: {
    title: "Unknown sign-in method",
    body: "Choose GitHub, Google or email on the sign-in page.",
  },
};

async function Reason({ searchParams }: { searchParams: PageProps<"/auth/error">["searchParams"] }) {
  const { reason } = await searchParams;
  const { title, body } = REASONS[typeof reason === "string" ? reason : ""] ?? REASONS.oauth;
  return <AuthHeading title={title} lead={body} />;
}

export default function AuthErrorPage({ searchParams }: PageProps<"/auth/error">) {
  return (
    <>
      <Suspense fallback={<AuthHeading title="Something went wrong" />}>
        <Reason searchParams={searchParams} />
      </Suspense>
      <Button asChild variant="default" size="lg" className="w-full">
        <Link href="/sign-in">Back to sign in</Link>
      </Button>
    </>
  );
}
