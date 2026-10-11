"use client";

import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";

export function AuthHeading({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <>
      <h1 className="text-display text-[clamp(24px,2.8vw,32px)]">{title}</h1>
      {lead ? <p className="-mt-1 text-base text-ink-2">{lead}</p> : null}
    </>
  );
}

export function FormAlert({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-crit/30 bg-crit/10 px-3.5 py-3 text-sm">
      <i className="mt-[7px] inline-block size-2 flex-none rounded-full bg-crit shadow-[0_0_8px_var(--cs-crit)]" />
      <span>{message}</span>
    </div>
  );
}

type FieldProps = ComponentProps<typeof Input> & {
  label: ReactNode;
  name: string;
  error?: string;
  hint?: string;
  labelAside?: ReactNode;
};

export function Field({ label, name, error, hint, labelAside, className, ...input }: FieldProps) {
  const id = `f-${name}`;
  const describedBy = error || hint ? `${id}-note` : undefined;
  return (
    <div className="grid gap-[7px]">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {labelAside}
      </div>
      <Input id={id} name={name} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={className} {...input} />
      {error || hint ? (
        <span id={describedBy} className={cn("text-[13px]", error ? "text-crit" : "text-ink-3")}>
          {error ?? hint}
        </span>
      ) : null}
    </div>
  );
}

export function SubmitButton({ children, pendingLabel }: { children: ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="default" size="lg" className="w-full" disabled={pending} aria-disabled={pending}>
      {pending ? <Loader label={pendingLabel} /> : children}
    </Button>
  );
}

export function OrDivider({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-[13px] text-ink-3 before:h-px before:bg-line after:h-px after:bg-line">
      {children}
    </div>
  );
}
