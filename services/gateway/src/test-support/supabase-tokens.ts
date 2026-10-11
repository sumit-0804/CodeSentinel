import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";

import { createSupabaseTokenVerifier, type SupabaseTokenVerifier } from "../auth/supabase-token.js";

export const TEST_SUPABASE_URL = "https://test-project.supabase.co";
export const TEST_ISSUER = `${TEST_SUPABASE_URL}/auth/v1`;
export const TEST_SUPABASE_SESSION_ID = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const KID = "test-key";

/** `expiresInSeconds` is measured from the test clock (jose's relative times use the real clock). */
interface SignOptions {
  expiresInSeconds?: number;
  issuer?: string;
  audience?: string;
}

/** A local ES256 key and JWKS standing in for the Supabase project's, so tests never call Supabase. */
export interface TestSupabase {
  verifier: SupabaseTokenVerifier;
  /** Signs a valid access token for `userId`; `claims` overrides or adds payload fields. */
  sign(userId: string, claims?: JWTPayload, options?: SignOptions): Promise<string>;
  /** Signs with a different key that is not in the JWKS. */
  signWithForeignKey(userId: string): Promise<string>;
}

export async function testSupabase(now: () => Date = () => new Date()): Promise<TestSupabase> {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const foreign = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "ES256", use: "sig" };
  const verifier = createSupabaseTokenVerifier({
    supabaseUrl: TEST_SUPABASE_URL,
    getKey: createLocalJWKSet({ keys: [jwk] }),
    now,
  });

  const build = (userId: string, claims: JWTPayload, options: SignOptions) => {
    const issuedAt = Math.floor(now().getTime() / 1000);
    return new SignJWT({
      role: "authenticated",
      aal: "aal1",
      amr: [{ method: "password", timestamp: Math.floor(now().getTime() / 1000) }],
      session_id: TEST_SUPABASE_SESSION_ID,
      email: "ada@example.com",
      user_metadata: { full_name: "Ada Lovelace", avatar_url: "https://avatars.example/ada.png" },
      app_metadata: { provider: "email", providers: ["email", "github"] },
      ...claims,
    })
      .setProtectedHeader({ alg: "ES256", kid: KID })
      .setSubject(userId)
      .setIssuer(options.issuer ?? TEST_ISSUER)
      .setAudience(options.audience ?? "authenticated")
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + (options.expiresInSeconds ?? 3600));
  };

  return {
    verifier,
    sign: (userId, claims = {}, options = {}) => build(userId, claims, options).sign(privateKey),
    signWithForeignKey: (userId) => build(userId, {}, {}).sign(foreign.privateKey),
  };
}
