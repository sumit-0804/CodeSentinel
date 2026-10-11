"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Check, Mail } from "lucide-react";
import { toast } from "sonner";
import { linkIdentity, signOut, unlinkIdentity } from "@/app/(app)/settings/actions";
import { GitHubIcon, GoogleIcon } from "@/components/brand/provider-icons";
import { UserAvatar, type ShellUser } from "@/components/shell/account-menus";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";

export type SignInMethod = { provider: "email" | "github" | "google"; label: string; detail: string | null };

const ICONS: Record<SignInMethod["provider"], ReactNode> = {
  email: <Mail className="size-[19px]" aria-hidden="true" />,
  github: <GitHubIcon className="size-[19px]" />,
  google: <GoogleIcon className="size-[19px]" />,
};

function Row({ children }: { children: ReactNode }) {
  return <li className="flex flex-wrap items-center gap-x-[18px] gap-y-3 border-b border-line px-5 py-[18px] last:border-b-0">{children}</li>;
}

function Confirm({ children, onConfirm, confirmLabel, onCancel, cancelLabel, pending }: {
  children: ReactNode;
  onConfirm: () => void;
  confirmLabel: string;
  onCancel: () => void;
  cancelLabel: string;
  pending: boolean;
}) {
  return (
    <div role="alert" className="flex w-full flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-xl border border-crit/30 bg-crit/8 px-3.5 py-3 text-sm">
      <span>{children}</span>
      <Button variant="destructive" onClick={onConfirm} disabled={pending}>
        {pending ? <Loader label="Working" /> : confirmLabel}
      </Button>
      <Button variant="ghost" onClick={onCancel} disabled={pending}>
        {cancelLabel}
      </Button>
    </div>
  );
}

export function AccountSettings({ user, methods }: { user: ShellUser; methods: SignInMethod[] }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const linkedCount = methods.filter((m) => m.detail).length;

  const run = (action: () => Promise<{ ok: boolean; message: string } | void>) =>
    startTransition(async () => {
      const result = await action();
      if (!result) return;
      setConfirm(null);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });

  return (
    <div className="grid min-w-0 gap-[30px]">
      <section className="grid gap-3.5">
        <h2 className="text-base font-bold">Profile</h2>
        <ul className="panel">
          <Row>
            <UserAvatar user={user} className="size-[46px] rounded-[13px]" />
            <span className="grid min-w-[180px] flex-1 gap-px">
              <b className="font-bold">{user.displayName}</b>
              <span className="text-sm text-ink-2">{user.email ?? "No email on this account"}</span>
            </span>
          </Row>
        </ul>
      </section>

      <section className="grid gap-3.5">
        <h2 className="text-base font-bold">Sign-in methods</h2>
        <ul className="panel">
          {methods.map((method) => {
            const linked = Boolean(method.detail);
            const isOAuth = method.provider !== "email";
            return (
              <Row key={method.provider}>
                <span className="grid size-10 flex-none place-items-center rounded-xl border border-line-2 bg-panel-3">{ICONS[method.provider]}</span>
                <span className="grid min-w-[180px] flex-1 gap-px">
                  <b className="font-bold">{method.label}</b>
                  <span className="text-sm text-ink-2">{method.detail ?? "Not connected"}</span>
                </span>
                {linked ? (
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-pass">
                    <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
                    Connected
                  </span>
                ) : null}
                {isOAuth && linked ? (
                  <Button
                    onClick={() => setConfirm(`unlink-${method.provider}`)}
                    disabled={linkedCount < 2 || pending}
                    title={linkedCount < 2 ? "Link another sign-in method first" : undefined}
                  >
                    Unlink
                  </Button>
                ) : null}
                {isOAuth && !linked ? (
                  <Button onClick={() => run(() => linkIdentity(method.provider))} disabled={pending}>
                    Link {method.label}
                  </Button>
                ) : null}
                {confirm === `unlink-${method.provider}` ? (
                  <Confirm
                    pending={pending}
                    confirmLabel={`Unlink ${method.label}`}
                    cancelLabel="Keep it"
                    onConfirm={() => run(() => unlinkIdentity(method.provider))}
                    onCancel={() => setConfirm(null)}
                  >
                    You won&apos;t be able to sign in with {method.label} after this.
                  </Confirm>
                ) : null}
              </Row>
            );
          })}
        </ul>
        <p className="text-[13px] text-ink-3">
          Keep at least one. Linking GitHub here only lets you sign in with it; connecting repositories is separate.
        </p>
      </section>

      <section className="grid gap-3.5">
        <h2 className="text-base font-bold">Sessions</h2>
        <ul className="panel">
          <Row>
            <span className="grid min-w-[180px] flex-1 gap-px">
              <b className="font-bold">Signed in on this browser</b>
              <span className="text-sm text-ink-2">Sign out here, or on every device at once.</span>
            </span>
            <Button onClick={() => run(() => signOut("local"))} disabled={pending}>
              Sign out
            </Button>
            <Button variant="destructive" onClick={() => setConfirm("signout-all")} disabled={pending}>
              Sign out of all devices
            </Button>
            {confirm === "signout-all" ? (
              <Confirm
                pending={pending}
                confirmLabel="Sign out everywhere"
                cancelLabel="Cancel"
                onConfirm={() => run(() => signOut("global"))}
                onCancel={() => setConfirm(null)}
              >
                Every device, this one included, will need to sign in again.
              </Confirm>
            ) : null}
          </Row>
        </ul>
      </section>
    </div>
  );
}
