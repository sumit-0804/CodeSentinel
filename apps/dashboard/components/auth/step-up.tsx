"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { DEFAULT_MFA_STEP_UP_MINUTES } from "@code-sentinel/contracts";
import { getStepUpState, verifyStepUp } from "@/app/(app)/settings/security-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";

type Result = { ok: boolean; code?: string };
/** Runs a server action; on `mfa_required` asks for a code and runs it once more. Null when the user cancels. */
type RunWithStepUp = <T extends Result>(action: () => Promise<T>) => Promise<T | null>;

const StepUpContext = createContext<RunWithStepUp | null>(null);

export function useStepUp(): RunWithStepUp {
  const run = useContext(StepUpContext);
  if (!run) throw new Error("useStepUp needs a StepUpProvider");
  return run;
}

/** One code dialog for every page in the app shell. */
export function StepUpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const settle = useRef<((verified: boolean) => void) | null>(null);

  const finish = useCallback((verified: boolean) => {
    settle.current?.(verified);
    settle.current = null;
    setOpen(false);
  }, []);

  const run = useCallback<RunWithStepUp>(async (action) => {
    const first = await action();
    if (first.ok || first.code !== "mfa_required") return first;
    const verified = await new Promise<boolean>((resolve) => {
      settle.current = resolve;
      setOpen(true);
    });
    return verified ? action() : null;
  }, []);

  return (
    <StepUpContext.Provider value={run}>
      {children}
      <Dialog open={open} onOpenChange={(next) => (next ? null : finish(false))}>
        <DialogContent className="max-w-[calc(100%-2rem)] gap-5 rounded-2xl border border-line-2 bg-panel p-6 sm:max-w-[420px]">
          {open ? <StepUpForm onVerified={() => finish(true)} onCancel={() => finish(false)} /> : null}
        </DialogContent>
      </Dialog>
    </StepUpContext.Provider>
  );
}

/** Asks for the 6-digit code, or explains how to set up an authenticator first. Used in the dialog and on `/step-up`. */
export function StepUpForm({ onVerified, onCancel, inDialog = true }: { onVerified: () => void; onCancel?: () => void; inDialog?: boolean }) {
  const [hasAuthenticator, setHasAuthenticator] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const Title = inDialog ? DialogTitle : "h2";
  const Description = inDialog ? DialogDescription : "p";

  useEffect(() => {
    let live = true;
    getStepUpState().then(
      (state) => live && setHasAuthenticator(state.hasAuthenticator),
      () => live && setHasAuthenticator(true),
    );
    return () => {
      live = false;
    };
  }, []);

  const submit = (value: string) =>
    startTransition(async () => {
      const result = await verifyStepUp(value);
      if (result.ok) return onVerified();
      setProblem(result.message);
      setCode("");
    });

  if (hasAuthenticator === null) {
    return (
      <div>
        <Title className="sr-only">Enter your authenticator code</Title>
        <Loader label="Checking your authenticator" className="text-cyan" />
      </div>
    );
  }

  if (!hasAuthenticator) {
    return (
      <div className="grid gap-4">
        <Title className="font-display text-lg font-semibold">Set up an authenticator app first</Title>
        <Description className="text-sm text-ink-2">
          Changing repositories and agents needs a code from an authenticator app, such as Google Authenticator, 1Password or Authy.
          It takes a minute.
        </Description>
        <div className="flex flex-wrap gap-2.5">
          <Button asChild variant="default">
            <Link href="/settings?section=security" onClick={onCancel}>
              Set up an authenticator
            </Link>
          </Button>
          {onCancel ? (
            <Button variant="ghost" onClick={onCancel}>
              Not now
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit(code);
      }}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 flex-none place-items-center rounded-xl border border-line-2 bg-panel-3 text-cyan">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </span>
        <div className="grid gap-1">
          <Title className="font-display text-lg leading-tight font-semibold">Enter your authenticator code</Title>
          <Description className="text-sm text-ink-2">
            Security changes need a fresh code. It counts for {DEFAULT_MFA_STEP_UP_MINUTES} minutes.
          </Description>
        </div>
      </div>
      <label className="grid gap-1.5 text-sm font-semibold">
        6-digit code
        <Input
          autoFocus
          value={code}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(digits);
            setProblem(null);
            if (digits.length === 6) submit(digits);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? "step-up-problem" : undefined}
          disabled={pending}
          className="font-mono text-xl tracking-[0.4em]"
        />
      </label>
      {problem ? (
        <p id="step-up-problem" role="alert" className="text-sm text-crit">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2.5">
        <Button type="submit" variant="default" disabled={pending || code.length !== 6}>
          {pending ? <Loader label="Checking" /> : "Verify"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
