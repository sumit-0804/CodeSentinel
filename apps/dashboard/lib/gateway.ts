import "server-only";
import type { z } from "zod";
import { requireUser } from "@/lib/auth";
import { gatewayUrl } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const TIMEOUT_MS = 5000;

/** Why a call failed, so a page can say what went wrong instead of crashing. */
export type GatewayFailure = "unconfigured" | "unreachable" | "unauthorized" | "error";
export type GatewayResult<T> = { ok: true; data: T } | { ok: false; reason: GatewayFailure; status?: number };

/**
 * Calls the gateway from the server with the signed-in user's Supabase access token (the BFF
 * pattern): the browser never talks to the gateway, so it needs no CORS and never sees the token.
 */
export async function gatewayFetch<T>(
  path: `/${string}`,
  schema: z.ZodType<T>,
  { organizationId, ...init }: RequestInit & { organizationId?: string } = {},
): Promise<GatewayResult<T>> {
  const base = gatewayUrl();
  if (!base) return { ok: false, reason: "unconfigured" };

  // requireUser verifies the token (getClaims) first; only then is the session's token sent on.
  await requireUser();
  const supabase = await createSupabaseServerClient();
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) return { ok: false, reason: "unauthorized" };

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");
  if (organizationId) headers.set("X-Organization-Id", organizationId);

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { ok: false, reason: "unreachable" };
  }

  if (response.status === 401 || response.status === 403) return { ok: false, reason: "unauthorized", status: response.status };
  if (!response.ok) return { ok: false, reason: "error", status: response.status };

  const parsed = schema.safeParse(await response.json().catch(() => undefined));
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, reason: "error", status: response.status };
}
