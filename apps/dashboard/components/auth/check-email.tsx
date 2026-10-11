import Link from "next/link";
import { Mail } from "lucide-react";
import { AuthHeading } from "./form-parts";

export function CheckEmail({ email, kind }: { email: string; kind: "signup" | "reset" }) {
  return (
    <>
      <span className="grid size-[52px] place-items-center rounded-[15px] border border-cyan/40 bg-panel-3 text-cyan shadow-[0_0_24px_-6px_rgb(61_240_255/0.7)]">
        <Mail className="size-5" aria-hidden="true" />
      </span>
      <AuthHeading
        title="Check your email"
        lead={
          kind === "reset" ? (
            <>
              If an account uses <b className="text-ink">{email}</b>, a reset link is on its way. It works for one hour.
            </>
          ) : (
            <>
              We sent a confirmation link to <b className="text-ink">{email}</b>. Open it on any device to finish.
            </>
          )
        }
      />
      <p role="status" className="text-[13px] text-ink-3">
        From no-reply@codesentinel.scribly.fun. Check spam if it isn&apos;t there in a minute.
      </p>
      <p className="text-[14.5px] text-ink-2">
        <Link href="/sign-in" className="font-semibold text-cyan hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
