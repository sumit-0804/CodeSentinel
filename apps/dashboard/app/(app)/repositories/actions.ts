"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  RepositoryConfigSchema,
  RepositoryConfigUpdateSchema,
  ReviewDefaultsSchema,
  ReviewDefaultsUpdateSchema,
  type RepositoryConfig,
  type ReviewDefaults,
} from "@code-sentinel/contracts";
import { gatewayFetch, type GatewayResult } from "@/lib/gateway";
import { getAccount } from "@/lib/organization";

/** `code: "mfa_required"` makes the client ask for an authenticator code and save again (`useStepUp`). */
export type SaveResult<T> = { ok: true; saved: T } | { ok: false; message: string; code?: string };

const MESSAGES: Record<string, string> = {
  admin_required: "Only organization admins can change this.",
  mfa_required: "Enter a code from your authenticator app to save this.",
  session_required: "Sign in again to change this.",
  no_agents_enabled: "Keep at least one agent on, or switch reviews off instead.",
  invalid_body: "Some of these settings aren't valid. Check the branches and try again.",
  repository_not_found: "This repository isn't in your organization any more.",
  organization_not_found: "This organization isn't available any more.",
};

function failure(result: Extract<GatewayResult<unknown>, { ok: false }>): { ok: false; message: string; code?: string } {
  if (result.code && MESSAGES[result.code]) return { ok: false, message: MESSAGES[result.code]!, code: result.code };
  if (result.reason === "unreachable" || result.reason === "unconfigured") return { ok: false, message: "Couldn't reach the API. Try again in a moment." };
  return { ok: false, message: "The API couldn't save this. Try again in a moment." };
}

const put = (body: unknown, organizationId: string) =>
  ({ method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, organizationId }) as const;

/** Saves a repository's agent modes, branches, threshold or reviews switch; the gateway checks the admin role. */
export async function saveRepositoryConfig(repositoryId: string, update: unknown): Promise<SaveResult<RepositoryConfig>> {
  const parsed = RepositoryConfigUpdateSchema.safeParse(update);
  if (!parsed.success || !z.string().uuid().safeParse(repositoryId).success) return { ok: false, message: MESSAGES.invalid_body! };
  const account = await getAccount();
  if (!account.ok || !account.current) return { ok: false, message: "Choose an organization first." };

  const result = await gatewayFetch(`/v1/repositories/${repositoryId}/config`, RepositoryConfigSchema, put(parsed.data, account.current.organizationId));
  if (!result.ok) return failure(result);
  revalidatePath("/repositories", "layout");
  return { ok: true, saved: result.data };
}

/** Saves the current organization's review defaults. */
export async function saveReviewDefaults(update: unknown): Promise<SaveResult<ReviewDefaults>> {
  const parsed = ReviewDefaultsUpdateSchema.safeParse(update);
  if (!parsed.success) return { ok: false, message: MESSAGES.invalid_body! };
  const account = await getAccount();
  if (!account.ok || !account.current) return { ok: false, message: "Choose an organization first." };

  const { organizationId } = account.current;
  const result = await gatewayFetch(`/v1/organizations/${organizationId}/review-defaults`, ReviewDefaultsSchema, put(parsed.data, organizationId));
  if (!result.ok) return failure(result);
  revalidatePath("/", "layout");
  return { ok: true, saved: result.data };
}
