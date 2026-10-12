import { forbidden, unauthorized } from "@code-sentinel/service-kit";
import type { NextFunction, Request } from "express";

import type { UserStore } from "../persistence/stores.js";
import type { GatewayResponse, Principal } from "./principal.js";

/** Account and configuration routes need a signed-in person, not a personal API key. */
export function requireUserSession(_req: Request, res: GatewayResponse, next: NextFunction): void {
  const { principal } = res.locals;
  if (!principal) throw unauthorized("unauthenticated", "Sign in or send an API key as a bearer token");
  if (principal.method !== "supabase") {
    throw forbidden("session_required", "This action needs a signed-in session, not an API key");
  }
  next();
}

/** How recent the TOTP code must be (`MFA_STEP_UP_MINUTES`), and the clock to judge it by. */
export interface StepUpPolicy {
  minutes: number;
  now: () => Date;
}

/**
 * Writes that change repositories or agents need a token from a TOTP code entered within `minutes`
 * (A7): `aal2` plus a fresh `totp` entry in `amr`. Anything else is 403 `mfa_required`.
 */
export function assertStepUp(principal: Principal, { minutes, now }: StepUpPolicy): void {
  const totpAt = principal.aal === "aal2" ? principal.amr?.find((entry) => entry.method === "totp")?.timestamp : undefined;
  const ageMs = totpAt === undefined ? Infinity : now().getTime() - totpAt * 1000;
  if (!(ageMs <= minutes * 60_000)) {
    throw forbidden("mfa_required", `Enter a code from your authenticator app; it counts for ${minutes} minutes`);
  }
}

/** Configuration writes need the organization's admin role; check it before `assertStepUp`, so members aren't asked for a code. */
export async function assertOrgAdmin(users: Pick<UserStore, "findById">, userId: string, organizationId: string): Promise<void> {
  const user = await users.findById(userId);
  const role = user?.memberships.find((m) => m.organizationId === organizationId)?.role;
  if (role !== "admin") throw forbidden("admin_required", "Only an organization admin can change this");
}

/** Organization-owned routes need one resolved organization; send `X-Organization-Id` when you belong to several. */
export function requireOrganization(_req: Request, res: GatewayResponse, next: NextFunction): void {
  const { principal } = res.locals;
  if (!principal) throw unauthorized("unauthenticated", "Sign in or send an API key as a bearer token");
  if (!principal.organizationId) {
    throw forbidden("organization_required", "Choose an organization with the X-Organization-Id header");
  }
  next();
}
