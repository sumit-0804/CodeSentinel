import { z } from "zod";

// Mirrors the Supabase password policy: 8+ characters with letters and digits.
export const passwordSchema = z
  .string()
  .min(8, "At least 8 characters, with a letter and a number.")
  .max(72, "Use 72 characters or fewer.")
  .regex(/[a-z]/i, "At least 8 characters, with a letter and a number.")
  .regex(/\d/, "At least 8 characters, with a letter and a number.");

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const signUpSchema = z.object({ email: emailSchema, password: passwordSchema });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The two passwords don't match." });

export type FieldErrors = Partial<Record<string, string>>;

/** State shared by every auth form's `useActionState`. */
export type FormState = {
  error?: string;
  fields?: FieldErrors;
  values?: { email?: string };
  /** Set once a confirmation or reset email is on its way; the form then shows "Check your email". */
  sent?: string;
};

export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
