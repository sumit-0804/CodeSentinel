"use server";

import { redirect } from "next/navigation";
import { authErrorMessage } from "@/lib/auth-errors";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-next-path";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  fieldErrors,
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  type FormState,
} from "@/lib/validation";

const PROVIDERS = ["github", "google"] as const;
type Provider = (typeof PROVIDERS)[number];
const isProvider = (value: unknown): value is Provider => PROVIDERS.includes(value as Provider);

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({ email: field(form, "email"), password: field(form, "password") });
  const values = { email: field(form, "email") };
  if (!parsed.success) return { fields: fieldErrors(parsed.error), values };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: authErrorMessage(error), values };

  redirect(safeNextPath(field(form, "next")));
}

export async function signInWithProvider(form: FormData): Promise<void> {
  const provider = field(form, "provider");
  if (!isProvider(provider)) redirect("/auth/error?reason=provider");

  const next = safeNextPath(field(form, "next"));
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${env().NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect("/auth/error?reason=oauth");
  redirect(data.url);
}

export async function signUp(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse({ email: field(form, "email"), password: field(form, "password") });
  const values = { email: field(form, "email") };
  if (!parsed.success) return { fields: fieldErrors(parsed.error), values };

  const supabase = await createSupabaseServerClient();
  // An existing email gets the same answer; Supabase hides it too, so accounts can't be enumerated.
  const { error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${env().NEXT_PUBLIC_SITE_URL}/auth/confirm` },
  });
  if (error) return { error: authErrorMessage(error), values };
  return { sent: parsed.data.email };
}

export async function requestPasswordReset(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse({ email: field(form, "email") });
  const values = { email: field(form, "email") };
  if (!parsed.success) return { fields: fieldErrors(parsed.error), values };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env().NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/reset-password`,
  });
  // Only rate limits are worth telling the user; anything else would reveal whether the email exists.
  if (error && error.status === 429) return { error: authErrorMessage(error), values };
  return { sent: parsed.data.email };
}

export async function resetPassword(_prev: FormState, form: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) redirect("/auth/error?reason=link");

  const parsed = resetPasswordSchema.safeParse({ password: field(form, "password"), confirm: field(form, "confirm") });
  if (!parsed.success) return { fields: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: authErrorMessage(error) };

  redirect("/overview");
}
