import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "@/components/auth/auth-forms";
import { AuthHeading, OrDivider } from "@/components/auth/form-parts";
import { OAuthButtons } from "@/components/auth/oauth-buttons";

export const metadata: Metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <>
      <AuthHeading
        title="Start reviewing"
        lead="Five agents check every pull request. Critical findings always block the merge."
      />
      <OAuthButtons verb="Sign up" />
      <OrDivider>or with email</OrDivider>
      <SignUpForm />
      <p className="text-[14.5px] text-ink-2">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-semibold text-cyan hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
