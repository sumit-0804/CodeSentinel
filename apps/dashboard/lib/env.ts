import { z } from "zod";

const httpUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//.test(value), "must start with http:// or https://");

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: httpUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  // Every auth redirect is built from this, never from the request's Host header.
  NEXT_PUBLIC_SITE_URL: httpUrl.transform((url) => url.replace(/\/+$/, "")),
});

export type DashboardEnv = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): DashboardEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Dashboard env is missing or invalid: ${fields}. See apps/dashboard/.env.example.`);
  }
  return result.data;
}

let cached: DashboardEnv | undefined;

// Read lazily so `next build` works without env (CI); the literal names let Next inline them.
export function env(): DashboardEnv {
  cached ??= parseEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });
  return cached;
}
