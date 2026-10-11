import type { SecretBox } from "@code-sentinel/db";

import type { GithubTokenStore, InstallationAccount, InstallationStore, SyncedRepository, UserStore } from "../persistence/stores.js";
import type { GitHubClient, InstallationRepository } from "./github-client.js";
import type { GitHubUserClient, GitHubUserTokens } from "./github-user-client.js";

/** Refresh a user token this long before GitHub says it expires. */
const REFRESH_MARGIN_MS = 60_000;

export interface SyncedInstallation {
  organizationId: string;
  accountLogin: string;
  accountType: "user" | "organization";
  repositoryCount: number;
}

/** No GitHub token is stored for the user: they never linked GitHub, or must link again. */
export class GithubNotLinkedError extends Error {
  constructor() {
    super("GitHub is not linked for this user");
    this.name = "GithubNotLinkedError";
  }
}

export interface InstallationSyncDeps {
  github: GitHubClient;
  githubUsers: GitHubUserClient;
  users: UserStore;
  installations: InstallationStore;
  githubTokens: GithubTokenStore;
  secretBox: SecretBox;
  now?: () => Date;
}

const toSynced = (repo: InstallationRepository): SyncedRepository => ({
  githubRepoId: repo.id,
  fullName: repo.fullName,
  defaultBranch: repo.defaultBranch,
  isPrivate: repo.isPrivate,
  ...(repo.language !== undefined ? { primaryLanguage: repo.language } : {}),
});

/**
 * Upserts one installation and its organization, then makes its repositories match GitHub's list (as
 * the App). Used by the user sync and by installation webhooks, which need no user token.
 */
export async function syncInstallationRepositories(
  { github, installations }: { github: GitHubClient; installations: InstallationStore },
  input: { githubInstallationId: number; account: InstallationAccount; suspendedAt?: Date },
  now: Date,
): Promise<{ organizationId: string; repositoryCount: number }> {
  const { organizationId } = await installations.upsert(input);
  const repos = (await github.listInstallationRepositories(input.githubInstallationId)).map(toSynced);
  await installations.syncRepositories(input.githubInstallationId, repos, now);
  return { organizationId, repositoryCount: repos.length };
}

/**
 * Brings Supabase in line with GitHub: the organizations, installations and repositories a user reaches
 * (with their role), or one installation when a webhook says it changed. Every step is an idempotent upsert.
 */
export class InstallationSync {
  private readonly deps: InstallationSyncDeps;
  private readonly now: () => Date;

  constructor(deps: InstallationSyncDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
  }

  /** Seals and stores a fresh user token; plaintext never reaches the store. */
  async storeTokens(userId: string, tokens: GitHubUserTokens): Promise<void> {
    const { secretBox, githubTokens } = this.deps;
    await githubTokens.put(userId, {
      accessTokenSealed: secretBox.seal(tokens.accessToken),
      ...(tokens.refreshToken ? { refreshTokenSealed: secretBox.seal(tokens.refreshToken) } : {}),
      ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
      ...(tokens.refreshExpiresAt ? { refreshExpiresAt: tokens.refreshExpiresAt } : {}),
    });
  }

  /** Syncs every installation the user can reach and records their role in each organization. */
  async syncForUser(userId: string): Promise<SyncedInstallation[]> {
    const { githubUsers, users } = this.deps;
    const accessToken = await this.accessToken(userId);
    const githubUserId = (await users.findById(userId))?.githubUserId;
    const synced: SyncedInstallation[] = [];

    for (const installation of await githubUsers.listInstallations(accessToken)) {
      const { account } = installation;
      const { organizationId, repositoryCount } = await syncInstallationRepositories(
        this.deps,
        {
          githubInstallationId: installation.id,
          account: { githubId: account.id, login: account.login, type: account.type },
          ...(installation.suspendedAt ? { suspendedAt: installation.suspendedAt } : {}),
        },
        this.now(),
      );
      const role =
        installation.account.type === "user"
          ? installation.account.id === githubUserId
            ? "admin"
            : "member"
          : await githubUsers.getOrgRole(accessToken, installation.account.login);
      await users.setMembership(organizationId, userId, role);
      synced.push({ organizationId, accountLogin: installation.account.login, accountType: installation.account.type, repositoryCount });
    }
    return synced;
  }

  /** The user's GitHub token, refreshed first when it is about to expire. */
  private async accessToken(userId: string): Promise<string> {
    const { githubTokens, githubUsers, secretBox } = this.deps;
    const stored = await githubTokens.get(userId);
    if (!stored) throw new GithubNotLinkedError();

    const expiresSoon = stored.expiresAt !== undefined && stored.expiresAt.getTime() - this.now().getTime() < REFRESH_MARGIN_MS;
    if (!expiresSoon) return secretBox.open(stored.accessTokenSealed);

    const refreshExpired = stored.refreshExpiresAt !== undefined && stored.refreshExpiresAt.getTime() <= this.now().getTime();
    if (!stored.refreshTokenSealed || refreshExpired) throw new GithubNotLinkedError();
    const fresh = await githubUsers.refresh(secretBox.open(stored.refreshTokenSealed));
    await this.storeTokens(userId, fresh);
    return fresh.accessToken;
  }
}
