import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";

/** What the gateway uses from a verified Supabase access token. */
export interface SupabaseClaims {
  userId: string;
  sessionId: string;
  /** `aal1` after a password or OAuth sign-in, `aal2` after a TOTP check (A7). */
  aal: string;
  /** Sign-in methods with their Unix timestamps, newest step-up included. */
  amr: { method: string; timestamp: number }[];
  email?: string;
  name?: string;
  avatarUrl?: string;
  /** `email`, `github`, `google`: every identity linked to the account. */
  providers: string[];
}

export interface SupabaseTokenVerifier {
  verify(token: string): Promise<SupabaseClaims>;
}

const text = z
  .string()
  .trim()
  .min(1)
  .optional()
  .catch(undefined);

// Only the claims we rely on are validated; Supabase adds others freely.
const ClaimsSchema = z.object({
  sub: z.string().uuid(),
  session_id: z.string().uuid(),
  role: z.literal("authenticated"),
  aal: z.string().default("aal1"),
  amr: z.array(z.object({ method: z.string(), timestamp: z.number() })).default([]),
  email: text,
  user_metadata: z
    .object({ full_name: text, name: text, user_name: text, avatar_url: text })
    .partial()
    .default({}),
  app_metadata: z
    .object({ providers: z.array(z.string()).optional().catch(undefined) })
    .partial()
    .default({}),
});

/**
 * Verifies a Supabase access token: ES256 signature from the project's JWKS, issuer, `authenticated`
 * audience and expiry, then the claims the gateway relies on. Throws on anything else.
 */
export function createSupabaseTokenVerifier({
  supabaseUrl,
  getKey,
  now = () => new Date(),
}: {
  supabaseUrl: string;
  /** Tests pass `createLocalJWKSet`; production fetches and caches the project's JWKS. */
  getKey?: JWTVerifyGetKey;
  now?: () => Date;
}): SupabaseTokenVerifier {
  const issuer = `${supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
  const keys = getKey ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  return {
    async verify(token) {
      const { payload } = await jwtVerify(token, keys, {
        algorithms: ["ES256"],
        issuer,
        audience: "authenticated",
        clockTolerance: 5,
        currentDate: now(),
      });
      const claims = ClaimsSchema.parse(payload);
      const meta = claims.user_metadata;
      const name = meta.full_name ?? meta.name ?? meta.user_name;
      return {
        userId: claims.sub,
        sessionId: claims.session_id,
        aal: claims.aal,
        amr: claims.amr,
        ...(claims.email ? { email: claims.email } : {}),
        ...(name ? { name } : {}),
        ...(meta.avatar_url ? { avatarUrl: meta.avatar_url } : {}),
        providers: claims.app_metadata.providers ?? [],
      };
    },
  };
}
