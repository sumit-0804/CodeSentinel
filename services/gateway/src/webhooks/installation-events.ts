import type { GitHubClient } from "../github/github-client.js";
import { syncInstallationRepositories } from "../github/installation-sync.js";
import type { InstallationAccount, InstallationStore } from "../persistence/stores.js";
import { InstallationEventSchema, InstallationRepositoriesEventSchema } from "./github-payload.js";

export interface InstallationEventDeps {
  github: GitHubClient;
  installations: InstallationStore;
  now: () => Date;
}

/** What happened, for the log line; `invalid_payload` means the body did not match the event's schema. */
export type InstallationOutcome = "installation_synced" | "installation_removed" | "installation_suspended" | "repositories_removed" | "event_ignored" | "invalid_payload";

const toAccount = (account: { id: number; login: string; type: string }): InstallationAccount => ({
  githubId: account.id,
  login: account.login,
  type: account.type === "Organization" ? "organization" : "user",
});

/**
 * Keeps installations and repositories in step with GitHub (A6). Only the App acts here, never a user,
 * so memberships are untouched: people join an organization through their own sync.
 */
export async function handleInstallationEvent(event: string, payload: unknown, deps: InstallationEventDeps): Promise<InstallationOutcome> {
  const { installations, now } = deps;

  if (event === "installation") {
    const parsed = InstallationEventSchema.safeParse(payload);
    if (!parsed.success) return "invalid_payload";
    const { action, installation } = parsed.data;
    switch (action) {
      case "created":
      case "new_permissions_accepted":
      case "unsuspend": {
        if (!installation.account) return "event_ignored";
        await syncInstallationRepositories(deps, { githubInstallationId: installation.id, account: toAccount(installation.account) }, now());
        return "installation_synced";
      }
      case "deleted":
        await installations.markUninstalled(installation.id, now());
        return "installation_removed";
      case "suspend":
        await installations.setSuspended(installation.id, installation.suspended_at ? new Date(installation.suspended_at) : now());
        return "installation_suspended";
      default:
        return "event_ignored";
    }
  }

  const parsed = InstallationRepositoriesEventSchema.safeParse(payload);
  if (!parsed.success) return "invalid_payload";
  const { action, installation, repositories_removed: removed } = parsed.data;
  if (action === "removed") {
    await installations.removeRepositories(installation.id, removed.map((repo) => repo.id), now());
    return "repositories_removed";
  }
  // The `added` payload lacks default branch and language, so the App's own list is the source.
  if (!installation.account) return "event_ignored";
  await syncInstallationRepositories(deps, { githubInstallationId: installation.id, account: toAccount(installation.account) }, now());
  return "installation_synced";
}
