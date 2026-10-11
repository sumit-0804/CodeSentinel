import { randomInt, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sha256Hex } from "../auth/hash.js";
import type { StoreSeed } from "../persistence/in-memory.js";
import { GithubAccountTakenError, type Stores } from "../persistence/stores.js";

/** A seed with fresh ids, so the contract can run against a shared database without touching other rows. */
export function uniqueSeed() {
  const organizationId = randomUUID();
  const repositoryId = randomUUID();
  const userId = randomUUID();
  const keyId = randomUUID();
  const revokedKeyId = randomUUID();
  const installationId = randomUUID();
  const githubRepoId = randomInt(1, 2 ** 47);
  const githubOrgId = randomInt(1, 2 ** 47);
  const githubInstallationId = randomInt(1, 2 ** 47);
  const orgLogin = `test-org-${githubOrgId}`;
  const apiKey = `cs_live_test_${randomUUID()}`;
  const revokedApiKey = `cs_live_test_${randomUUID()}`;

  const seed: StoreSeed = {
    organizations: [
      { organizationId, defaultConfidenceThreshold: 0.75, githubOrgId, login: orgLogin, accountType: "organization", displayName: "Test Org" },
    ],
    installations: [{ installationId, organizationId, githubInstallationId, accountLogin: orgLogin }],
    repositories: [
      {
        repositoryId,
        organizationId,
        githubInstallationId: installationId,
        githubRepoId,
        fullName: `${orgLogin}/repo-${githubRepoId}`,
        reviewEnabled: true,
        defaultBranch: "main",
        isPrivate: true,
      },
    ],
    repositorySettings: [],
    repositoryAgentConfig: [],
    activeSessionIds: [],
    githubTokens: [],
    apiKeys: [
      { keyId, userId, organizationId, label: "Test", keyPrefix: apiKey.slice(0, 12), keyHash: sha256Hex(apiKey) },
      {
        keyId: revokedKeyId,
        userId,
        organizationId,
        label: "Revoked",
        keyPrefix: revokedApiKey.slice(0, 12),
        keyHash: sha256Hex(revokedApiKey),
        revokedAt: new Date(Date.now() - 1000),
      },
    ],
    users: [
      {
        userId,
        githubLogin: `octo-${githubRepoId}`,
        email: `user-${userId}@example.test`,
        memberships: [{ organizationId, displayName: "Test Org", role: "admin" }],
      },
    ],
  };
  return {
    seed,
    ids: { organizationId, repositoryId, userId, keyId, githubRepoId, installationId, githubInstallationId, githubOrgId, orgLogin },
    apiKey,
    revokedApiKey,
  };
}

type UniqueSeed = ReturnType<typeof uniqueSeed>;

/** Rows a case created outside its seed, for implementations that must delete them afterwards. */
export interface CreatedRows {
  userIds?: string[];
  githubOrgIds?: number[];
}

/**
 * The behaviour every `Stores` implementation must share. `makeStores` builds stores holding exactly
 * `seed` (plus whatever unrelated rows already exist). `cleanUp` removes rows a case created itself;
 * `sessions: false` skips the session cases where active sessions cannot be seeded (a real Supabase project).
 */
export function describeStoresContract(
  makeStores: (seed: StoreSeed) => Promise<Stores>,
  options: { sessions: boolean; cleanUp?: (rows: CreatedRows) => Promise<void> } = { sessions: true },
): void {
  const { cleanUp } = options;
  async function build(edit: (s: UniqueSeed) => void = () => {}) {
    const unique = uniqueSeed();
    edit(unique);
    return { stores: await makeStores(unique.seed), ...unique };
  }

  describe("repositories", () => {
    it("finds a repository by GitHub repo id and misses an unknown one", async () => {
      const { stores, ids, seed } = await build();

      const { repositoryId, organizationId, githubInstallationId, fullName, reviewEnabled } = seed.repositories[0]!;
      await expect(stores.repositories.findByGithubRepoId(ids.githubRepoId)).resolves.toEqual({
        repositoryId,
        organizationId,
        githubInstallationId,
        githubRepoId: ids.githubRepoId,
        fullName,
        reviewEnabled,
      });
      await expect(stores.repositories.findByGithubRepoId(ids.githubRepoId + 1)).resolves.toBeUndefined();
    });
  });

  describe("repositoryConfig", () => {
    it("uses the repository override when one is set", async () => {
      const { stores, ids } = await build(({ seed, ids }) => {
        seed.repositorySettings.push({ repositoryId: ids.repositoryId, confidenceThresholdOverride: 0.9 });
      });

      await expect(stores.repositoryConfig.getEffectiveConfig(ids.repositoryId)).resolves.toMatchObject({
        confidenceThreshold: 0.9,
        thresholdSource: "repository_override",
      });
    });

    it("falls back to the organization default and the settings defaults", async () => {
      const { stores, ids } = await build(({ seed, ids }) => {
        seed.repositorySettings.push({ repositoryId: ids.repositoryId, confidenceThresholdOverride: null });
      });

      await expect(stores.repositoryConfig.getEffectiveConfig(ids.repositoryId)).resolves.toEqual({
        enabledAgents: ["security", "style", "performance", "logic", "documentation"],
        confidenceThreshold: 0.75,
        thresholdSource: "organization_default",
        agentTimeoutMs: 20000,
        autoFixStyle: true,
        postInlineComments: true,
      });
    });

    it("returns the stored settings", async () => {
      const { stores, ids } = await build(({ seed, ids }) => {
        seed.repositorySettings.push({
          repositoryId: ids.repositoryId,
          agentTimeoutMs: 45000,
          autoFixStyle: false,
          postInlineComments: false,
        });
      });

      await expect(stores.repositoryConfig.getEffectiveConfig(ids.repositoryId)).resolves.toMatchObject({
        agentTimeoutMs: 45000,
        autoFixStyle: false,
        postInlineComments: false,
      });
    });

    it("drops a disabled agent and keeps the rest in contract order", async () => {
      const { stores, ids } = await build(({ seed, ids }) => {
        seed.repositoryAgentConfig.push(
          { repositoryId: ids.repositoryId, agent: "documentation", enabled: true },
          { repositoryId: ids.repositoryId, agent: "style", enabled: false },
        );
      });

      const config = await stores.repositoryConfig.getEffectiveConfig(ids.repositoryId);

      expect(config?.enabledAgents).toEqual(["security", "performance", "logic", "documentation"]);
    });

    it("returns undefined for an unknown repository", async () => {
      const { stores } = await build();

      await expect(stores.repositoryConfig.getEffectiveConfig(randomUUID())).resolves.toBeUndefined();
    });
  });

  describe("apiKeys", () => {
    it("finds an active key by hash and never a revoked or unknown one", async () => {
      const { stores, apiKey, revokedApiKey, seed } = await build();

      await expect(stores.apiKeys.findActiveByKeyHash(sha256Hex(apiKey))).resolves.toEqual(seed.apiKeys[0]);
      await expect(stores.apiKeys.findActiveByKeyHash(sha256Hex(revokedApiKey))).resolves.toBeUndefined();
      await expect(stores.apiKeys.findActiveByKeyHash(sha256Hex("cs_live_unknown"))).resolves.toBeUndefined();
    });

    it("records when a key was last used", async () => {
      const { stores, apiKey, ids } = await build();
      const now = new Date("2026-10-11T10:00:00.000Z");

      await stores.apiKeys.touchLastUsed(ids.keyId, now);
      await stores.apiKeys.touchLastUsed(randomUUID(), now);

      await expect(stores.apiKeys.findActiveByKeyHash(sha256Hex(apiKey))).resolves.toMatchObject({ lastUsedAt: now });
    });
  });

  describe("users", () => {
    it("returns a user with their memberships and misses an unknown id", async () => {
      const { stores, ids, seed } = await build();

      await expect(stores.users.findById(ids.userId)).resolves.toEqual(seed.users[0]);
      await expect(stores.users.findById(randomUUID())).resolves.toBeUndefined();
    });

    it("omits the GitHub login of a user who has not linked GitHub", async () => {
      const { stores, ids } = await build(({ seed }) => {
        delete seed.users[0]!.githubLogin;
      });

      const user = await stores.users.findById(ids.userId);

      expect(user).toBeDefined();
      expect(user).not.toHaveProperty("githubLogin");
    });

    it("records a first sign-in as a new user without memberships", async () => {
      const { stores } = await build();
      const userId = randomUUID();

      await stores.users.recordSignIn({ userId, email: `new-${userId}@example.test`, name: "Ada Lovelace", avatarUrl: "https://a.example/ada.png" }, new Date());

      await expect(stores.users.findById(userId)).resolves.toEqual({
        userId,
        email: `new-${userId}@example.test`,
        name: "Ada Lovelace",
        avatarUrl: "https://a.example/ada.png",
        memberships: [],
      });
      await cleanUp?.({ userIds: [userId] });
    });

    it("refreshes an existing user's profile and keeps their memberships", async () => {
      const { stores, ids, seed } = await build();

      await stores.users.recordSignIn({ userId: ids.userId, name: "Renamed" }, new Date());

      const user = await stores.users.findById(ids.userId);
      expect(user).toMatchObject({ name: "Renamed", email: seed.users[0]!.email, memberships: seed.users[0]!.memberships });
    });

    it("skips an email another user already holds instead of failing", async () => {
      const { stores, seed } = await build();
      const userId = randomUUID();

      await stores.users.recordSignIn({ userId, email: seed.users[0]!.email!, name: "Duplicate" }, new Date());

      const user = await stores.users.findById(userId);
      expect(user).toMatchObject({ userId, name: "Duplicate" });
      expect(user).not.toHaveProperty("email");
      await cleanUp?.({ userIds: [userId] });
    });
  });

  describe.skipIf(!options.sessions)("sessions", () => {
    it("reports a signed-in session as active and an unknown one as not", async () => {
      const sessionId = randomUUID();
      const { stores } = await build(({ seed }) => {
        seed.activeSessionIds.push(sessionId);
      });

      await expect(stores.sessions.isActive(sessionId)).resolves.toBe(true);
      await expect(stores.sessions.isActive(randomUUID())).resolves.toBe(false);
    });
  });

  const repo = (githubRepoId: number, fullName: string) => ({ githubRepoId, fullName, defaultBranch: "main", isPrivate: true });
  const names = async (stores: Stores, organizationId: string) =>
    (await stores.repositories.listForOrganization(organizationId)).map((r) => r.fullName);

  describe("GitHub accounts and memberships", () => {
    it("links a GitHub account, re-links it to the same user, and refuses it for another user", async () => {
      const secondUserId = randomUUID();
      const { stores, ids } = await build(({ seed }) => {
        seed.users.push({ userId: secondUserId, memberships: [] });
      });
      const githubUserId = randomInt(1, 2 ** 47);

      await stores.users.linkGithub(ids.userId, { githubUserId, login: "octo-linked" });
      await stores.users.linkGithub(ids.userId, { githubUserId, login: "octo-renamed" });
      await expect(stores.users.findById(ids.userId)).resolves.toMatchObject({ githubUserId, githubLogin: "octo-renamed" });
      await expect(stores.users.linkGithub(secondUserId, { githubUserId, login: "octo-renamed" })).rejects.toThrow(GithubAccountTakenError);
    });

    it("applies a known role, and on an unknown one only inserts member without touching an existing role", async () => {
      const { stores, ids } = await build();
      const githubOrgId = randomInt(1, 2 ** 47);
      const created = await stores.installations.upsert({
        githubInstallationId: randomInt(1, 2 ** 47),
        account: { githubId: githubOrgId, login: `org-${githubOrgId}`, type: "organization" },
      });
      const roleIn = async (organizationId: string) =>
        (await stores.users.findById(ids.userId))?.memberships.find((m) => m.organizationId === organizationId)?.role;

      await stores.users.setMembership(created.organizationId, ids.userId, undefined);
      expect(await roleIn(created.organizationId)).toBe("member");
      await stores.users.setMembership(ids.organizationId, ids.userId, undefined);
      expect(await roleIn(ids.organizationId)).toBe("admin");
      await stores.users.setMembership(ids.organizationId, ids.userId, "member");
      expect(await roleIn(ids.organizationId)).toBe("member");
      await cleanUp?.({ githubOrgIds: [githubOrgId] });
    });
  });

  describe("installations", () => {
    it("upserts the account's organization and installation, idempotently", async () => {
      const { stores, ids } = await build();
      const account = { githubId: ids.githubOrgId, login: ids.orgLogin, type: "organization" as const };

      const first = await stores.installations.upsert({ githubInstallationId: ids.githubInstallationId, account });
      const again = await stores.installations.upsert({ githubInstallationId: ids.githubInstallationId, account });

      expect(first).toEqual({ organizationId: ids.organizationId, installationId: ids.installationId });
      expect(again).toEqual(first);
    });

    it("creates a new organization for a new account", async () => {
      const { stores, ids } = await build();
      const githubOrgId = randomInt(1, 2 ** 47);
      const created = await stores.installations.upsert({
        githubInstallationId: randomInt(1, 2 ** 47),
        account: { githubId: githubOrgId, login: `octo-${githubOrgId}`, type: "user" },
      });
      await stores.users.setMembership(created.organizationId, ids.userId, "admin");

      const listed = await stores.installations.listForUser(ids.userId);
      expect(listed.find((i) => i.organizationId === created.organizationId)).toMatchObject({
        accountLogin: `octo-${githubOrgId}`,
        accountType: "user",
        suspended: false,
        repositoryCount: 0,
      });
      expect(created.organizationId).not.toBe(ids.organizationId);
      await cleanUp?.({ githubOrgIds: [githubOrgId] });
    });

    it("syncs repositories: adds new ones, renames by GitHub id, and marks missing ones removed", async () => {
      const { stores, ids } = await build();
      const added = randomInt(1, 2 ** 47);
      const now = new Date();

      await stores.installations.syncRepositories(ids.githubInstallationId, [repo(ids.githubRepoId, `${ids.orgLogin}/renamed`), repo(added, `${ids.orgLogin}/new`)], now);
      expect(await names(stores, ids.organizationId)).toEqual([`${ids.orgLogin}/new`, `${ids.orgLogin}/renamed`]);

      await stores.installations.syncRepositories(ids.githubInstallationId, [repo(added, `${ids.orgLogin}/new`)], now);
      expect(await names(stores, ids.organizationId)).toEqual([`${ids.orgLogin}/new`]);
      await expect(stores.repositories.findByGithubRepoId(ids.githubRepoId)).resolves.toBeUndefined();
    });

    it("brings a removed repository back, with its id, when it is added again", async () => {
      const { stores, ids } = await build();
      const now = new Date();

      await stores.installations.removeRepositories(ids.githubInstallationId, [ids.githubRepoId], now);
      await expect(stores.repositories.findByGithubRepoId(ids.githubRepoId)).resolves.toBeUndefined();

      await stores.installations.addRepositories(ids.githubInstallationId, [repo(ids.githubRepoId, `${ids.orgLogin}/back`)], now);
      await expect(stores.repositories.findByGithubRepoId(ids.githubRepoId)).resolves.toMatchObject({
        repositoryId: ids.repositoryId,
        fullName: `${ids.orgLogin}/back`,
      });
    });

    it("lets a new repository take the name of a removed one", async () => {
      const { stores, ids, seed } = await build();
      const replacement = randomInt(1, 2 ** 47);
      const name = seed.repositories[0]!.fullName;

      await stores.installations.syncRepositories(ids.githubInstallationId, [repo(replacement, name)], new Date());

      await expect(stores.repositories.findByGithubRepoId(replacement)).resolves.toMatchObject({ fullName: name });
      await expect(stores.repositories.findByGithubRepoId(ids.githubRepoId)).resolves.toBeUndefined();
    });

    it("ignores a suspended installation's pull requests and resumes after unsuspend", async () => {
      const { stores, ids } = await build();

      await stores.installations.setSuspended(ids.githubInstallationId, new Date());
      await expect(stores.repositories.findByGithubRepoId(ids.githubRepoId)).resolves.toBeUndefined();
      expect(await names(stores, ids.organizationId)).toHaveLength(1);

      await stores.installations.setSuspended(ids.githubInstallationId, null);
      await expect(stores.repositories.findByGithubRepoId(ids.githubRepoId)).resolves.toBeDefined();
    });

    it("marks an uninstalled installation and its repositories removed, and a re-install restores the installation", async () => {
      const { stores, ids } = await build();

      await stores.installations.markUninstalled(ids.githubInstallationId, new Date());
      expect(await names(stores, ids.organizationId)).toEqual([]);
      expect(await stores.installations.listForUser(ids.userId)).toEqual([]);

      await stores.installations.upsert({
        githubInstallationId: ids.githubInstallationId,
        account: { githubId: ids.githubOrgId, login: ids.orgLogin, type: "organization" },
      });
      expect(await stores.installations.listForUser(ids.userId)).toHaveLength(1);
    });

    it("lists only the organization's own repositories", async () => {
      const mine = await build();
      const theirs = await build();

      expect(await names(mine.stores, mine.ids.organizationId)).toEqual([mine.seed.repositories[0]!.fullName]);
      expect(await names(mine.stores, theirs.ids.organizationId)).not.toContain(mine.seed.repositories[0]!.fullName);
    });
  });

  describe("githubTokens", () => {
    it("stores sealed tokens per user and replaces them on refresh", async () => {
      const { stores, ids } = await build();
      const expiresAt = new Date(Date.now() + 3_600_000);

      await expect(stores.githubTokens.get(ids.userId)).resolves.toBeUndefined();
      await stores.githubTokens.put(ids.userId, { accessTokenSealed: "v1.a", refreshTokenSealed: "v1.r", expiresAt });
      await stores.githubTokens.put(ids.userId, { accessTokenSealed: "v1.b", refreshTokenSealed: "v1.s", expiresAt });

      await expect(stores.githubTokens.get(ids.userId)).resolves.toEqual({ accessTokenSealed: "v1.b", refreshTokenSealed: "v1.s", expiresAt });
    });
  });
}
