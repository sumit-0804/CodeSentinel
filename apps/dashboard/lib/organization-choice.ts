import type { CurrentUser } from "@code-sentinel/contracts";

/** The organization the user is working in; only ever trusted after checking their memberships. */
export const ORG_COOKIE = "cs_org";

export type Organization = CurrentUser["organizations"][number];

/** The cookie's organization when the user belongs to it, otherwise their first; undefined with none. */
export function pickOrganization(organizations: Organization[], requested: string | undefined): Organization | undefined {
  return organizations.find((org) => org.organizationId === requested) ?? organizations[0];
}
