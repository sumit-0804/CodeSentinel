"use client";

import { useState, useTransition } from "react";
import { Laptop } from "lucide-react";
import { toast } from "sonner";
import type { Session } from "@code-sentinel/contracts";
import { revokeSession } from "@/app/(app)/settings/security-actions";
import { useStepUp } from "@/components/auth/step-up";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { describeDevice } from "@/lib/user-agent";

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso));

/** Settings → Security: the user's signed-in devices, and signing one out (WP6). `sessions` is null when they couldn't be loaded. */
export function SignedInDevices({ sessions }: { sessions: Session[] | null }) {
  const withStepUp = useStepUp();
  const [pending, startTransition] = useTransition();
  const [signingOut, setSigningOut] = useState<string | null>(null);

  const signOut = (sessionId: string) => {
    setSigningOut(sessionId);
    startTransition(async () => {
      const result = await withStepUp(() => revokeSession(sessionId));
      setSigningOut(null);
      if (!result) return;
      if (!result.ok) return void toast.error(result.message);
      toast.success("That device is signed out.");
    });
  };

  return (
    <section className="grid gap-3.5" aria-labelledby="devices-h">
      <div>
        <h2 id="devices-h" className="text-base font-bold">
          Signed-in devices
        </h2>
        <p className="mt-1.5 max-w-[62ch] text-[14.5px] text-ink-2">
          Every browser signed in to your account. Sign out one you don&apos;t recognise; it stops working at once.
        </p>
      </div>
      <ul className="panel">
        {sessions === null ? (
          <li className="px-5 py-[18px] text-sm text-ink-2">Couldn&apos;t load your devices. Try again in a moment.</li>
        ) : (
          sessions.map((session) => (
            <li key={session.sessionId} className="flex flex-wrap items-center gap-x-[18px] gap-y-3 border-b border-line px-5 py-[18px] last:border-b-0">
              <span className="grid size-10 flex-none place-items-center rounded-xl border border-line-2 bg-panel-3">
                <Laptop className="size-[19px]" aria-hidden="true" />
              </span>
              <span className="grid min-w-[200px] flex-1 gap-px">
                <b className="flex flex-wrap items-center gap-2 font-bold">
                  {describeDevice(session.userAgent)}
                  {session.current ? (
                    <span className="rounded-full border border-pass/40 px-2 text-[11.5px] font-semibold text-pass">This device</span>
                  ) : null}
                </b>
                <span className="text-sm text-ink-2">
                  {session.ip ? `${session.ip} · ` : ""}
                  Last active {when(session.lastActiveAt ?? session.createdAt)} UTC · Signed in {when(session.createdAt)} UTC
                </span>
              </span>
              {session.current ? null : (
                <Button onClick={() => signOut(session.sessionId)} disabled={pending}>
                  {signingOut === session.sessionId ? <Loader label="Signing out" /> : "Sign out"}
                </Button>
              )}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
