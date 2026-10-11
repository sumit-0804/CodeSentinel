import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/auth-forms";
import { AuthHeading } from "@/components/auth/form-parts";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeading
        title="Reset your password"
        lead="Enter the email you signed up with and we'll send a link to choose a new password."
      />
      <ForgotPasswordForm />
      <p className="text-[14.5px] text-ink-2">
        <Link href="/sign-in" className="font-semibold text-cyan hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
