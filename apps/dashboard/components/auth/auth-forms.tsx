"use client";

import { useActionState, type ReactNode } from "react";
import Link from "next/link";
import { requestPasswordReset, resetPassword, signIn, signUp } from "@/app/(auth)/actions";
import type { FormState } from "@/lib/validation";
import { CheckEmail } from "./check-email";
import { Field, FormAlert, SubmitButton } from "./form-parts";

const PASSWORD_HINT = "At least 8 characters, with a letter and a number.";
const initial: FormState = {};

export function SignInForm({ nextField }: { nextField?: ReactNode }) {
  const [state, action] = useActionState(signIn, initial);
  return (
    <form action={action} noValidate className="grid gap-3.5">
      {nextField}
      <FormAlert message={state.error} />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={state.fields?.email}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        placeholder="Your password"
        required
        error={state.fields?.password}
        labelAside={
          <Link href="/forgot-password" className="text-[13px] font-semibold text-cyan hover:underline">
            Forgot password?
          </Link>
        }
      />
      <SubmitButton pendingLabel="Signing in">Sign in</SubmitButton>
    </form>
  );
}

export function SignUpForm() {
  const [state, action] = useActionState(signUp, initial);
  if (state.sent) return <CheckEmail email={state.sent} kind="signup" />;
  return (
    <form action={action} noValidate className="grid gap-3.5">
      <FormAlert message={state.error} />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        required
        defaultValue={state.values?.email}
        error={state.fields?.email}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        hint={PASSWORD_HINT}
        error={state.fields?.password}
      />
      <SubmitButton pendingLabel="Creating your account">Create account</SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordReset, initial);
  if (state.sent) return <CheckEmail email={state.sent} kind="reset" />;
  return (
    <form action={action} noValidate className="grid gap-3.5">
      <FormAlert message={state.error} />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={state.fields?.email}
      />
      <SubmitButton pendingLabel="Sending the link">Send reset link</SubmitButton>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action] = useActionState(resetPassword, initial);
  return (
    <form action={action} noValidate className="grid gap-3.5">
      <FormAlert message={state.error} />
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        hint={PASSWORD_HINT}
        error={state.fields?.password}
      />
      <Field
        label="Confirm new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        error={state.fields?.confirm}
      />
      <SubmitButton pendingLabel="Saving your password">Save password</SubmitButton>
    </form>
  );
}
