import "server-only";
import { RepositoryConfigSchema, ReviewDefaultsSchema, type RepositoryConfig, type ReviewDefaults } from "@code-sentinel/contracts";
import { gatewayFetch, type GatewayFailure } from "@/lib/gateway";
import { getRepositories } from "@/lib/repositories";

export type RepositoryPageData =
  | { ok: true; config: RepositoryConfig; defaults: ReviewDefaults; isAdmin: boolean }
  | { ok: false; reason: GatewayFailure | "not_found" };

export type DefaultsPageData =
  | { ok: true; defaults: ReviewDefaults; organizationName: string; isAdmin: boolean }
  | { ok: false; reason: GatewayFailure | "no_organization" };

/** A repository of the current organization by its GitHub full name, with its configuration and the org's defaults. */
export async function getRepositoryPageData(fullName: string): Promise<RepositoryPageData> {
  const listed = await getRepositories();
  if (!listed.ok) return listed;
  const repository = listed.repositories.find((repo) => repo.fullName.toLowerCase() === fullName.toLowerCase());
  if (!repository || !listed.organization) return { ok: false, reason: "not_found" };

  const { organizationId, role } = listed.organization;
  const [config, defaults] = await Promise.all([
    gatewayFetch(`/v1/repositories/${repository.repositoryId}/config`, RepositoryConfigSchema, { organizationId }),
    gatewayFetch(`/v1/organizations/${organizationId}/review-defaults`, ReviewDefaultsSchema, { organizationId }),
  ]);
  if (!config.ok) return { ok: false, reason: config.status === 404 ? "not_found" : config.reason };
  if (!defaults.ok) return { ok: false, reason: defaults.reason };
  return { ok: true, config: config.data, defaults: defaults.data, isAdmin: role === "admin" };
}

/** The current organization's review defaults. */
export async function getDefaultsPageData(): Promise<DefaultsPageData> {
  const listed = await getRepositories();
  if (!listed.ok) return listed;
  if (!listed.organization) return { ok: false, reason: "no_organization" };

  const { organizationId, displayName, role } = listed.organization;
  const defaults = await gatewayFetch(`/v1/organizations/${organizationId}/review-defaults`, ReviewDefaultsSchema, { organizationId });
  if (!defaults.ok) return { ok: false, reason: defaults.reason };
  return { ok: true, defaults: defaults.data, organizationName: displayName, isAdmin: role === "admin" };
}
