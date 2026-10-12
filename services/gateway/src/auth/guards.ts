import { forbidden, unauthorized } from "@code-sentinel/service-kit";
import type { NextFunction, Request } from "express";

import type { UserStore } from "../persistence/stores.js";
import type { GatewayResponse } from "./principal.js";

/** Account and configuration routes need a signed-in person, not a personal API key. */
export function requireUserSession(_req: Request, res: GatewayResponse, next: NextFunction): void {
  const { principal } = res.locals;
  if (!principal) throw unauthorized("unauthenticated", "Sign in or send an API key as a bearer token");
  if (principal.method !== "supabase") {
    throw forbidden("session_required", "This action needs a signed-in session, not an API key");
  }
  next();
}

/** Configuration writes need the organization's admin role; A7 adds the TOTP step-up next to this check. */
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
