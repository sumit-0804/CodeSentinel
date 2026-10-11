import type { Metadata } from "next";
import Link from "next/link";
import { SignInForm } from "@/components/auth/auth-forms";
import { AuthHeading, OrDivider } from "@/components/auth/form-parts";
import { NextField } from "@/components/auth/next-field";
import { OAuthButtons } from "@/components/auth/oauth-buttons";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <>
      <AuthHeading title="Welcome back" lead="Sign in to see what's blocking your merges." />
      <OAuthButtons verb="Continue" nextField={<NextField searchParams={searchParams} />} />
      <OrDivider>or with email</OrDivider>
      <SignInForm nextField={<NextField searchParams={searchParams} />} />
      <p className="text-[14.5px] text-ink-2">
        New here?{" "}
        <Link href="/sign-up" className="font-semibold text-cyan hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
