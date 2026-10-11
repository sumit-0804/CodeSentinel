import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { CurrentUserSchema, type CurrentUser } from "@code-sentinel/contracts";
import { gatewayFetch, type GatewayFailure } from "@/lib/gateway";
import { ORG_COOKIE, pickOrganization, type Organization } from "@/lib/organization-choice";

export type Account =
  | { ok: true; me: CurrentUser; organizations: Organization[]; current: Organization | undefined }
  | { ok: false; reason: GatewayFailure };

/** `/v1/me` plus the organization in use (the `cs_org` cookie, if the user belongs to it), read once per request. */
export const getAccount = cache(async (): Promise<Account> => {
  const me = await gatewayFetch("/v1/me", CurrentUserSchema);
  if (!me.ok) return { ok: false, reason: me.reason };
  const requested = (await cookies()).get(ORG_COOKIE)?.value;
  return { ok: true, me: me.data, organizations: me.data.organizations, current: pickOrganization(me.data.organizations, requested) };
});
