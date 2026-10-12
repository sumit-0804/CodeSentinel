"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authErrorMessage } from "@/lib/auth-errors";
import { requireUser } from "@/lib/auth";
import { hasFreshStepUp, listAuthenticators } from "@/lib/mfa";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** `code: "mfa_required"` tells the client to ask for an authenticator code and try again. */
export type MfaResult<T = object> = ({ ok: true } & T) | { ok: false; message: string; code?: string };

const CodeSchema = z.string().trim().regex(/^\d{6}$/);
const FactorIdSchema = z.string().uuid();
const NameSchema = z.string().trim().min(1).max(40);

const BAD_CODE = { ok: false, message: "Enter the 6-digit code from your authenticator app." } as const;
const STEP_UP = { ok: false, message: "Enter a code from your authenticator app first.", code: "mfa_required" } as const;

/** What the step-up dialog shows: the code field, or a pointer to set up an authenticator first. */
export async function getStepUpState(): Promise<{ hasAuthenticator: boolean; fresh: boolean }> {
  await requireUser();
  const [authenticators, fresh] = await Promise.all([listAuthenticators(), hasFreshStepUp()]);
  return { hasAuthenticator: authenticators.length > 0, fresh };
}

/** Checks a code against the user's first authenticator; the session's new token is `aal2` with a fresh TOTP time. */
export async function verifyStepUp(code: string): Promise<MfaResult> {
  await requireUser();
  const parsed = CodeSchema.safeParse(code);
  if (!parsed.success) return BAD_CODE;
  const [authenticator] = await listAuthenticators();
  if (!authenticator) return { ok: false, message: "Set up an authenticator app first, in Settings → Security." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: authenticator.id, code: parsed.data });
  if (error) return { ok: false, message: authErrorMessage(error) };
  return { ok: true };
}

/**
 * Starts adding an authenticator: returns the QR code (an SVG data URI) and the secret to type in instead.
 * Adding a second one needs a fresh code from the first, like any other security change.
 */
export async function startEnrollment(name: string): Promise<MfaResult<{ factorId: string; qrCode: string; secret: string }>> {
  await requireUser();
  const friendlyName = NameSchema.safeParse(name);
  if (!friendlyName.success) return { ok: false, message: "Give it a name of up to 40 characters, like “Phone”." };
  const existing = await listAuthenticators();
  if (existing.length > 0 && !(await hasFreshStepUp())) return STEP_UP;

  const supabase = await createSupabaseServerClient();
  // An enrolment that was never confirmed would block the name and count towards the limit.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const stale of factors?.all.filter((factor) => factor.status === "unverified") ?? []) {
    await supabase.auth.mfa.unenroll({ factorId: stale.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: friendlyName.data, issuer: "Code Sentinel" });
  if (error || !data) return { ok: false, message: authErrorMessage(error) };
  return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/** Confirms a new authenticator with its first code; this also counts as a step-up. */
export async function confirmEnrollment(factorId: string, code: string): Promise<MfaResult> {
  await requireUser();
  const parsed = CodeSchema.safeParse(code);
  if (!FactorIdSchema.safeParse(factorId).success || !parsed.success) return BAD_CODE;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: parsed.data });
  if (error) return { ok: false, message: authErrorMessage(error) };
  revalidatePath("/settings");
  return { ok: true };
}

/** Drops an enrolment the user abandoned before confirming it. Verified authenticators are left alone. */
export async function cancelEnrollment(factorId: string): Promise<void> {
  await requireUser();
  if (!FactorIdSchema.safeParse(factorId).success) return;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  if (data?.all.some((factor) => factor.id === factorId && factor.status === "unverified")) {
    await supabase.auth.mfa.unenroll({ factorId });
  }
}

/** Removes an authenticator after a fresh code. */
export async function removeAuthenticator(factorId: string): Promise<MfaResult> {
  await requireUser();
  if (!FactorIdSchema.safeParse(factorId).success) return { ok: false, message: "That authenticator wasn't found." };
  if (!(await hasFreshStepUp())) return STEP_UP;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return error.code === "insufficient_aal" ? STEP_UP : { ok: false, message: authErrorMessage(error) };
  revalidatePath("/settings");
  return { ok: true };
}
