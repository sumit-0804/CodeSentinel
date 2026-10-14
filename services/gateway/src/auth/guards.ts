import { isStepUpFresh } from "@code-sentinel/contracts";
import { forbidden, unauthorized } from "@code-sentinel/service-kit";
import type { NextFunction, Request } from "express";

import type { UserStore } from "../persistence/stores.js";
import type { GatewayResponse, Principal } from "./principal.js";

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
  if (!isStepUpFresh(principal, now().getTime(), minutes)) {
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
  if (!principal) throw unauthorized("unauthenticated", "Sign in and send your access token as a bearer token");
  if (!principal.organizationId) {
    throw forbidden("organization_required", "Choose an organization with the X-Organization-Id header");
  }
  next();
}
