import { randomUUID } from "node:crypto";

import type { AgentKind, AgentMode } from "@code-sentinel/contracts";

import {
  modesOf,
  resolveEffectiveConfig,
  type OrganizationDefaultsInput,
  type RepositoryConfigInputs,
  type RepositorySettingsInput,
} from "./effective-config.js";
import {
  GithubAccountTakenError,
  storedStatuses,
  type GithubTokenStore,
  type InstallationStore,
  type RepositoryConfigStore,
  type RepositoryRecord,
  type RepositoryStore,
  type ReviewRecord,
  type ReviewStore,
  type SealedGithubTokens,
  type SessionStore,
  type Stores,
  type SyncedRepository,
  type UserRecord,
  type UserStore,
} from "./stores.js";

export interface SeedOrganization {
  organizationId: string;
  defaultConfidenceThreshold?: number;
  defaultReviewBranches?: string[];
  /** GitHub identity of the account; set for organizations created by an installation. */
  githubOrgId?: number;
  login?: string;
  accountType?: "user" | "organization";
  displayName?: string;
}

export interface SeedInstallation {
  installationId: string;
  organizationId: string;
  githubInstallationId: number;
  accountLogin: string;
  suspendedAt?: Date;
  uninstalledAt?: Date;
}

/** A `repositories` row with the columns only the store itself reads. */
export interface SeedRepository extends RepositoryRecord {
  defaultBranch?: string;
  /** Defaults to true, like the column. */
  useOrgDefaults?: boolean;
  isPrivate?: boolean;
  primaryLanguage?: string;
  removedAt?: Date;
}

export interface StoreSeed {
  organizations: SeedOrganization[];
  /** Installations the seed knows; a repository pointing at an unknown installation counts as installed. */
  installations: SeedInstallation[];
  repositories: SeedRepository[];
  repositorySettings: ({ repositoryId: string; updatedAt?: Date; updatedBy?: string } & RepositorySettingsInput)[];
  /** Only rows that exist; an agent without a row falls back to the platform default. */
  repositoryAgentConfig: { repositoryId: string; agent: AgentKind; mode: AgentMode; updatedAt?: Date; updatedBy?: string }[];
  organizationAgentDefaults: { organizationId: string; agent: AgentKind; mode: AgentMode }[];
  /** Supabase session ids that are still signed in; like `auth.sessions`, any other id is not active. */
  activeSessionIds: string[];
  users: UserRecord[];
  githubTokens: ({ userId: string } & SealedGithubTokens)[];
  /** `reviews` rows; the repository's name is looked up, as the database joins it. */
  reviews: SeedReview[];
}

export type SeedReview = Omit<ReviewRecord, "repositoryFullName"> & { githubCheckRunId?: number; jobId?: string };

export const emptySeed = (): StoreSeed => ({
  reviews: [],
  organizations: [],
  installations: [],
  repositories: [],
  repositorySettings: [],
  repositoryAgentConfig: [],
  organizationAgentDefaults: [],
  activeSessionIds: [],
  users: [],
  githubTokens: [],
});

/**
 * Every store over plain arrays, for tests and `GATEWAY_SEED=dev`. Records are copied on the
 * way in and out, so callers cannot mutate the stored rows.
 */
export class InMemoryStores implements Stores {
  readonly repositories: RepositoryStore;
  readonly repositoryConfig: RepositoryConfigStore;
  readonly reviews: ReviewStore;
  readonly sessions: SessionStore;
  readonly users: UserStore;
  readonly installations: InstallationStore;
  readonly githubTokens: GithubTokenStore;

  constructor(seed: StoreSeed = emptySeed()) {
    const data: StoreSeed = structuredClone(seed);

    const installationById = (installationId: string) => data.installations.find((i) => i.installationId === installationId);
    const installationByGithubId = (githubInstallationId: number) =>
      data.installations.find((i) => i.githubInstallationId === githubInstallationId);
    const isLive = (repo: SeedRepository) => {
      const installation = installationById(repo.githubInstallationId);
      return repo.removedAt === undefined && installation?.uninstalledAt === undefined && installation?.suspendedAt === undefined;
    };
    const toRepositoryRecord = (repo: SeedRepository): RepositoryRecord => {
      const { repositoryId, organizationId, githubInstallationId, githubRepoId, fullName, reviewEnabled } = repo;
      const githubInstallationNumber = installationById(githubInstallationId)?.githubInstallationId;
      return {
        repositoryId,
        organizationId,
        githubInstallationId,
        ...(githubInstallationNumber !== undefined ? { githubInstallationNumber } : {}),
        githubRepoId,
        fullName,
        reviewEnabled,
      };
    };
    const displayNameOf = (organizationId: string) => {
      const org = data.organizations.find((o) => o.organizationId === organizationId);
      return org?.displayName ?? org?.login ?? "Organization";
    };

    const upsertRepository = (installation: SeedInstallation, repo: SyncedRepository, now: Date) => {
      // GitHub names are unique, so an active row still holding this name under another id is stale.
      for (const other of data.repositories) {
        if (other.organizationId === installation.organizationId && other.fullName === repo.fullName && other.githubRepoId !== repo.githubRepoId && other.removedAt === undefined) {
          other.removedAt = new Date(now);
        }
      }
      const fields = {
        organizationId: installation.organizationId,
        githubInstallationId: installation.installationId,
        fullName: repo.fullName,
        defaultBranch: repo.defaultBranch,
        isPrivate: repo.isPrivate,
        ...(repo.primaryLanguage !== undefined ? { primaryLanguage: repo.primaryLanguage } : {}),
      };
      const existing = data.repositories.find((r) => r.githubRepoId === repo.githubRepoId);
      if (existing) {
        Object.assign(existing, fields);
        delete existing.removedAt;
      } else {
        data.repositories.push({ repositoryId: randomUUID(), githubRepoId: repo.githubRepoId, reviewEnabled: true, ...fields });
      }
    };

    this.repositories = {
      findByGithubRepoId: async (githubRepoId) => {
        const repo = data.repositories.find((r) => r.githubRepoId === githubRepoId);
        return repo && isLive(repo) ? toRepositoryRecord(repo) : undefined;
      },
      findForOrganization: async (organizationId, repositoryId) => {
        const repo = data.repositories.find((r) => r.repositoryId === repositoryId && r.organizationId === organizationId);
        return repo && isLive(repo) ? toRepositoryRecord(repo) : undefined;
      },
      listForOrganization: async (organizationId) =>
        data.repositories
          .filter((r) => r.organizationId === organizationId && r.removedAt === undefined && installationById(r.githubInstallationId)?.uninstalledAt === undefined)
          .sort((a, b) => a.fullName.localeCompare(b.fullName))
          .map((r) => ({
            repositoryId: r.repositoryId,
            fullName: r.fullName,
            defaultBranch: r.defaultBranch ?? "main",
            isPrivate: r.isPrivate ?? true,
            ...(r.primaryLanguage !== undefined ? { primaryLanguage: r.primaryLanguage } : {}),
            reviewEnabled: r.reviewEnabled,
          })),
    };

    const organizationDefaults = (organizationId: string): OrganizationDefaultsInput | undefined => {
      const org = data.organizations.find((o) => o.organizationId === organizationId);
      if (!org) return undefined;
      return {
        ...(org.defaultConfidenceThreshold !== undefined ? { threshold: org.defaultConfidenceThreshold } : {}),
        modes: modesOf(data.organizationAgentDefaults.filter((row) => row.organizationId === organizationId)),
        reviewBranches: [...(org.defaultReviewBranches ?? [])],
      };
    };
    const configInputs = (repository: SeedRepository): RepositoryConfigInputs => {
      const { repositoryId } = repository;
      const stored = data.repositorySettings.find((s) => s.repositoryId === repositoryId);
      const agentRows = data.repositoryAgentConfig.filter((row) => row.repositoryId === repositoryId);
      const latest = latestUpdate([stored, ...agentRows]);
      const { repositoryId: _id, updatedAt: _at, updatedBy: _by, ...settings } = stored ?? { repositoryId };
      return structuredClone({
        repositoryId,
        organizationId: repository.organizationId,
        fullName: repository.fullName,
        defaultBranch: repository.defaultBranch ?? "main",
        reviewEnabled: repository.reviewEnabled,
        useOrgDefaults: repository.useOrgDefaults ?? true,
        ...(stored ? { settings } : {}),
        repositoryModes: modesOf(agentRows),
        organization: organizationDefaults(repository.organizationId) ?? { modes: {}, reviewBranches: [] },
        ...(latest?.updatedAt ? { updatedAt: latest.updatedAt } : {}),
        ...(latest?.updatedBy ? { updatedBy: latest.updatedBy } : {}),
      });
    };

    this.repositoryConfig = {
      getEffectiveConfig: async (repositoryId) => {
        const repository = data.repositories.find((r) => r.repositoryId === repositoryId);
        return repository ? resolveEffectiveConfig(configInputs(repository)) : undefined;
      },
      getConfigInputs: async (repositoryId) => {
        const repository = data.repositories.find((r) => r.repositoryId === repositoryId && r.removedAt === undefined);
        return repository ? configInputs(repository) : undefined;
      },
      updateConfig: async (repositoryId, update, updatedBy) => {
        const repository = data.repositories.find((r) => r.repositoryId === repositoryId);
        if (!repository) return;
        const { reviewEnabled, useOrgDefaults, agents, ...settings } = update;
        if (reviewEnabled !== undefined) repository.reviewEnabled = reviewEnabled;
        if (useOrgDefaults !== undefined) repository.useOrgDefaults = useOrgDefaults;
        const updatedAt = new Date();
        for (const { agent, mode } of agents ?? []) {
          const row = data.repositoryAgentConfig.find((r) => r.repositoryId === repositoryId && r.agent === agent);
          if (row) Object.assign(row, { mode, updatedAt, updatedBy });
          else data.repositoryAgentConfig.push({ repositoryId, agent, mode, updatedAt, updatedBy });
        }
        if (Object.keys(settings).length > 0) {
          const row = data.repositorySettings.find((s) => s.repositoryId === repositoryId);
          const fields = { ...structuredClone(settings), updatedAt, updatedBy };
          if (row) Object.assign(row, fields);
          else data.repositorySettings.push({ repositoryId, ...fields });
        }
      },
      getReviewDefaults: async (organizationId) => organizationDefaults(organizationId),
      updateReviewDefaults: async (organizationId, update) => {
        const org = data.organizations.find((o) => o.organizationId === organizationId);
        if (!org) return;
        if (update.confidenceThreshold !== undefined) org.defaultConfidenceThreshold = update.confidenceThreshold;
        if (update.reviewBranches !== undefined) org.defaultReviewBranches = [...update.reviewBranches];
        for (const { agent, mode } of update.agents ?? []) {
          const row = data.organizationAgentDefaults.find((r) => r.organizationId === organizationId && r.agent === agent);
          if (row) row.mode = mode;
          else data.organizationAgentDefaults.push({ organizationId, agent, mode });
        }
      },
    };

    const toRecord = ({ githubCheckRunId: _checkRunId, jobId: _jobId, ...review }: SeedReview): ReviewRecord =>
      structuredClone({
        ...review,
        repositoryFullName: data.repositories.find((r) => r.repositoryId === review.repositoryId)?.fullName ?? "unknown/unknown",
      });

    this.reviews = {
      list: async (organizationId, { repositoryId, status, latest, limit, offset }) => {
        const statuses = status ? storedStatuses(status) : undefined;
        let rows = data.reviews
          .filter(
            (r) =>
              r.organizationId === organizationId &&
              (!repositoryId || r.repositoryId === repositoryId) &&
              (!statuses || statuses.includes(r.status)) &&
              (!latest || r.prNumber !== undefined),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (latest) {
          const seen = new Set<string>();
          rows = rows.filter((r) => {
            const key = `${r.repositoryId}#${r.prNumber}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }
        return { rows: rows.slice(offset, offset + limit).map(toRecord), total: rows.length };
      },
      get: async (organizationId, reviewId) => {
        const review = data.reviews.find((r) => r.reviewId === reviewId && r.organizationId === organizationId);
        return review ? toRecord(review) : undefined;
      },
      recordCheckRun: async (reviewId, { checkRunId, conclusion }) => {
        const review = data.reviews.find((r) => r.reviewId === reviewId);
        if (review) Object.assign(review, { githubCheckRunId: checkRunId, checkConclusion: conclusion });
      },
      activeForPullRequest: async (repositoryId, prNumber) =>
        data.reviews
          .filter((r) => r.repositoryId === repositoryId && r.prNumber === prNumber && r.jobId && (r.status === "queued" || r.status === "running"))
          .map((r) => ({ reviewId: r.reviewId, jobId: r.jobId!, headSha: r.headSha, createdAt: new Date(r.createdAt) })),
    };

    this.sessions = {
      isActive: async (sessionId) => data.activeSessionIds.includes(sessionId),
    };

    this.users = {
      findById: async (userId) => copy(data.users.find((u) => u.userId === userId)),
      recordSignIn: async ({ userId, email, name, avatarUrl }) => {
        // Mirrors the unique `users.email`: an address another row holds is skipped, not an error.
        const emailFree = email !== undefined && !data.users.some((u) => u.email === email && u.userId !== userId);
        const fields = {
          ...(emailFree ? { email } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(avatarUrl !== undefined ? { avatarUrl } : {}),
        };
        const existing = data.users.find((u) => u.userId === userId);
        if (existing) Object.assign(existing, fields);
        else data.users.push({ userId, memberships: [], ...fields });
      },
      linkGithub: async (userId, { githubUserId, login }) => {
        if (data.users.some((u) => u.githubUserId === githubUserId && u.userId !== userId)) throw new GithubAccountTakenError();
        const user = data.users.find((u) => u.userId === userId);
        if (user) Object.assign(user, { githubUserId, githubLogin: login });
      },
      setMembership: async (organizationId, userId, role) => {
        const user = data.users.find((u) => u.userId === userId);
        if (!user) return;
        const existing = user.memberships.find((m) => m.organizationId === organizationId);
        if (existing) {
          if (role !== undefined) existing.role = role;
        } else {
          user.memberships.push({ organizationId, displayName: displayNameOf(organizationId), role: role ?? "member" });
        }
      },
    };

    this.installations = {
      upsert: async ({ githubInstallationId, account, suspendedAt }) => {
        let org = data.organizations.find((o) => o.githubOrgId === account.githubId);
        if (org) Object.assign(org, { login: account.login, displayName: account.login, accountType: account.type });
        else {
          org = { organizationId: randomUUID(), githubOrgId: account.githubId, login: account.login, displayName: account.login, accountType: account.type };
          data.organizations.push(org);
        }
        let installation = installationByGithubId(githubInstallationId);
        if (installation) {
          Object.assign(installation, { organizationId: org.organizationId, accountLogin: account.login });
          delete installation.uninstalledAt;
        } else {
          installation = { installationId: randomUUID(), organizationId: org.organizationId, githubInstallationId, accountLogin: account.login };
          data.installations.push(installation);
        }
        if (suspendedAt) installation.suspendedAt = new Date(suspendedAt);
        else delete installation.suspendedAt;
        return { organizationId: org.organizationId, installationId: installation.installationId };
      },
      setSuspended: async (githubInstallationId, at) => {
        const installation = installationByGithubId(githubInstallationId);
        if (!installation) return;
        if (at) installation.suspendedAt = new Date(at);
        else delete installation.suspendedAt;
      },
      markUninstalled: async (githubInstallationId, at) => {
        const installation = installationByGithubId(githubInstallationId);
        if (!installation) return;
        installation.uninstalledAt = new Date(at);
        for (const repo of data.repositories) {
          if (repo.githubInstallationId === installation.installationId && repo.removedAt === undefined) repo.removedAt = new Date(at);
        }
      },
      syncRepositories: async (githubInstallationId, repos, now) => {
        const installation = installationByGithubId(githubInstallationId);
        if (!installation) return;
        for (const repo of repos) upsertRepository(installation, repo, now);
        const keep = new Set(repos.map((r) => r.githubRepoId));
        for (const repo of data.repositories) {
          if (repo.githubInstallationId === installation.installationId && !keep.has(repo.githubRepoId) && repo.removedAt === undefined) {
            repo.removedAt = new Date(now);
          }
        }
      },
      addRepositories: async (githubInstallationId, repos, now) => {
        const installation = installationByGithubId(githubInstallationId);
        if (installation) for (const repo of repos) upsertRepository(installation, repo, now);
      },
      removeRepositories: async (githubInstallationId, githubRepoIds, at) => {
        const installation = installationByGithubId(githubInstallationId);
        if (!installation) return;
        for (const repo of data.repositories) {
          if (repo.githubInstallationId === installation.installationId && githubRepoIds.includes(repo.githubRepoId) && repo.removedAt === undefined) {
            repo.removedAt = new Date(at);
          }
        }
      },
      listForUser: async (userId) => {
        const orgIds = new Set(data.users.find((u) => u.userId === userId)?.memberships.map((m) => m.organizationId) ?? []);
        return data.installations
          .filter((i) => orgIds.has(i.organizationId) && i.uninstalledAt === undefined)
          .map((i) => ({
            installationId: i.installationId,
            organizationId: i.organizationId,
            githubInstallationId: i.githubInstallationId,
            accountLogin: i.accountLogin,
            accountType: data.organizations.find((o) => o.organizationId === i.organizationId)?.accountType ?? "organization",
            suspended: i.suspendedAt !== undefined,
            repositoryCount: data.repositories.filter((r) => r.githubInstallationId === i.installationId && r.removedAt === undefined).length,
          }))
          .sort((a, b) => a.accountLogin.localeCompare(b.accountLogin));
      },
    };

    this.githubTokens = {
      get: async (userId) => {
        const row = data.githubTokens.find((t) => t.userId === userId);
        if (!row) return undefined;
        const { userId: _userId, ...tokens } = structuredClone(row);
        return tokens;
      },
      put: async (userId, tokens) => {
        data.githubTokens = data.githubTokens.filter((t) => t.userId !== userId);
        data.githubTokens.push({ userId, ...structuredClone(tokens) });
      },
    };
  }
}

type Audited = { updatedAt?: Date; updatedBy?: string };

function latestUpdate(rows: (Audited | undefined)[]): Audited | undefined {
  let latest: Audited | undefined;
  for (const row of rows) {
    if (row?.updatedAt && (!latest?.updatedAt || row.updatedAt > latest.updatedAt)) latest = row;
  }
  return latest;
}

function copy<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
