import "server-only";
import { cache } from "react";
import { RepositoryListResponseSchema, type Repository } from "@code-sentinel/contracts";
import { gatewayFetch, type GatewayFailure } from "@/lib/gateway";
import { getAccount } from "@/lib/organization";
import type { Organization } from "@/lib/organization-choice";

export type RepositoriesResult =
  | { ok: true; organization: Organization | undefined; repositories: Repository[] }
  | { ok: false; reason: GatewayFailure };

/** The current organization's active repositories (none without an organization), read once per request. */
export const getRepositories = cache(async (): Promise<RepositoriesResult> => {
  const account = await getAccount();
  if (!account.ok) return account;
  if (!account.current) return { ok: true, organization: undefined, repositories: [] };

  const listed = await gatewayFetch("/v1/repositories", RepositoryListResponseSchema, { organizationId: account.current.organizationId });
  if (!listed.ok) return { ok: false, reason: listed.reason };
  return { ok: true, organization: account.current, repositories: listed.data.items };
});
