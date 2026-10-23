"use client";

import { useState, useTransition } from "react";
import { Copy, ShieldCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { cancelEnrollment, confirmEnrollment, removeAuthenticator, startEnrollment } from "@/app/(app)/settings/security-actions";
import { useStepUp } from "@/components/auth/step-up";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import type { Authenticator } from "@/lib/mfa";

type Enrollment = { factorId: string; qrCode: string; secret: string };

/** A name not already taken, since Supabase refuses two authenticators with the same name. */
function suggestedName(authenticators: Authenticator[]): string {
  const taken = new Set(authenticators.map((a) => a.name));
  return ["Phone", "Backup phone", ...[3, 4, 5, 6, 7, 8, 9, 10].map((n) => `Authenticator ${n}`)].find((name) => !taken.has(name)) ?? "";
}

const added = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));

/** Settings → Security: optional authenticator apps (TOTP); once added, sign-in and security changes need a code (A7). */
export function SecuritySettings({ authenticators }: { authenticators: Authenticator[] }) {
  const withStepUp = useStepUp();
  const [pending, startTransition] = useTransition();
  // Null until the user types, so the suggestion follows the list after each add or remove.
  const [typedName, setName] = useState<string | null>(null);
  const name = typedName ?? suggestedName(authenticators);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const start = () =>
    startTransition(async () => {
      const result = await withStepUp(() => startEnrollment(name));
      if (!result) return;
      if (!result.ok) return void toast.error(result.message);
      setEnrollment({ factorId: result.factorId, qrCode: result.qrCode, secret: result.secret });
      setCode("");
      setProblem(null);
    });

  const confirm = (value: string) =>
    startTransition(async () => {
      if (!enrollment) return;
      const result = await confirmEnrollment(enrollment.factorId, value);
      if (!result.ok) {
        setProblem(result.message);
        setCode("");
        return;
      }
      setEnrollment(null);
      setName(null);
      toast.success(authenticators.length === 0 ? "Authenticator added. Add a second one as a backup." : "Backup authenticator added.");
    });

  const cancel = () =>
    startTransition(async () => {
      if (enrollment) await cancelEnrollment(enrollment.factorId);
      setEnrollment(null);
    });

  const remove = (id: string) =>
    startTransition(async () => {
      const result = await withStepUp(() => removeAuthenticator(id));
      setRemoving(null);
      if (!result) return;
      if (!result.ok) return void toast.error(result.message);
      toast.success("Authenticator removed.");
    });

  return (
    <div className="grid min-w-0 gap-[30px]">
      <section className="grid gap-3.5">
        <div>
          <h2 className="text-base font-bold">Authenticator apps</h2>
          <p className="mt-1.5 max-w-[62ch] text-[14.5px] text-ink-2">
            Optional, and recommended. Once you add an app such as Google Authenticator, 1Password or Authy, signing in and security
            changes (repositories, agents, fixes, signing out devices) also ask for a code from it.
          </p>
        </div>
        <ul className="panel">
          {authenticators.length === 0 ? (
            <li className="px-5 py-[18px] text-sm text-ink-2">No authenticator yet. Your password or GitHub/Google sign-in is all that protects this account.</li>
          ) : (
            authenticators.map((authenticator) => (
              <li key={authenticator.id} className="flex flex-wrap items-center gap-x-[18px] gap-y-3 border-b border-line px-5 py-[18px] last:border-b-0">
                <span className="grid size-10 flex-none place-items-center rounded-xl border border-line-2 bg-panel-3">
                  <Smartphone className="size-[19px]" aria-hidden="true" />
                </span>
                <span className="grid min-w-[180px] flex-1 gap-px">
                  <b className="font-bold">{authenticator.name}</b>
                  <span className="text-sm text-ink-2">Added {added(authenticator.createdAt)}</span>
                </span>
                {removing === authenticator.id ? (
                  <div role="alert" className="flex w-full flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-xl border border-crit/30 bg-crit/8 px-3.5 py-3 text-sm">
                    <span>
                      {authenticators.length === 1
                        ? "This is your only authenticator. Without it, signing in and security changes won't ask for a code any more."
                        : "Codes from this app will stop working."}
                    </span>
                    <Button variant="destructive" onClick={() => remove(authenticator.id)} disabled={pending}>
                      {pending ? <Loader label="Removing" /> : "Remove"}
                    </Button>
                    <Button variant="ghost" onClick={() => setRemoving(null)} disabled={pending}>
                      Keep it
                    </Button>
                  </div>
                ) : (
                  <Button onClick={() => setRemoving(authenticator.id)} disabled={pending || enrollment !== null}>
                    Remove
                  </Button>
                )}
              </li>
            ))
          )}
        </ul>
        {authenticators.length === 1 && !enrollment ? (
          <p className="text-[13px] text-warn">There are no recovery codes, so add a second authenticator as a backup in case you lose this one.</p>
        ) : null}
      </section>

      {enrollment ? (
        <section className="grid gap-3.5" aria-labelledby="enrol-h">
          <h2 id="enrol-h" className="text-base font-bold">
            Add {name}
          </h2>
          <div className="panel grid gap-5 p-5 sm:grid-cols-[auto_minmax(0,1fr)]">
            {/* Supabase returns the QR code as an SVG data URI (CSP img-src allows data:); next/image adds nothing here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enrollment.qrCode} alt="QR code to scan with your authenticator app" className="size-[176px] rounded-xl bg-white p-2" />
            <div className="grid content-start gap-4">
              <ol className="grid list-decimal gap-1.5 pl-5 text-sm text-ink-2">
                <li>Scan the QR code with your authenticator app.</li>
                <li>Can&apos;t scan? Enter this key instead.</li>
                <li>Type the 6-digit code it shows.</li>
              </ol>
              <div className="flex min-w-0 items-center gap-2">
                <code className="min-w-0 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 font-mono text-[13px] [overflow-wrap:anywhere]">{enrollment.secret}</code>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Copy the key"
                  onClick={() => navigator.clipboard.writeText(enrollment.secret).then(() => toast.success("Key copied"), () => toast.error("Couldn't copy; select it instead."))}
                >
                  <Copy className="size-4" aria-hidden="true" />
                </Button>
              </div>
              <form
                className="grid gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  confirm(code);
                }}
              >
                <label className="grid max-w-[240px] gap-1.5 text-sm font-semibold">
                  6-digit code
                  <Input
                    autoFocus
                    value={code}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
                      setCode(digits);
                      setProblem(null);
                      if (digits.length === 6) confirm(digits);
                    }}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    aria-invalid={problem ? true : undefined}
                    aria-describedby={problem ? "enrol-problem" : undefined}
                    disabled={pending}
                    className="font-mono text-xl tracking-[0.4em]"
                  />
                </label>
                {problem ? (
                  <p id="enrol-problem" role="alert" className="text-sm text-crit">
                    {problem}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2.5">
                  <Button type="submit" variant="default" disabled={pending || code.length !== 6}>
                    {pending ? <Loader label="Checking" /> : "Confirm"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={cancel} disabled={pending}>
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </section>
      ) : (
        <section className="grid gap-3.5" aria-labelledby="add-h">
          <h2 id="add-h" className="text-base font-bold">
            {authenticators.length === 0 ? "Add an authenticator" : "Add a backup authenticator"}
          </h2>
          <form
            className="panel flex flex-wrap items-end gap-3 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              start();
            }}
          >
            <label className="grid min-w-[200px] flex-1 gap-1.5 text-sm font-semibold">
              Name
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} required />
            </label>
            <Button type="submit" variant="default" disabled={pending || name.trim() === ""}>
              {pending ? <Loader label="Starting" /> : (
                <>
                  <ShieldCheck className="size-4" aria-hidden="true" />
                  Add authenticator
                </>
              )}
            </Button>
          </form>
        </section>
      )}
    </div>
  );
}
