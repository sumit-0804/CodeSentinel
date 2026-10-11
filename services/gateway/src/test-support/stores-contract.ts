import { randomInt, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sha256Hex } from "../auth/hash.js";
import type { StoreSeed } from "../persistence/in-memory.js";
import type { Stores } from "../persistence/stores.js";

/** A seed with fresh ids, so the contract can run against a shared database without touching other rows. */
export function uniqueSeed() {
  const organizationId = randomUUID();
  const repositoryId = randomUUID();
  const userId = randomUUID();
  const keyId = randomUUID();
  const revokedKeyId = randomUUID();
  const githubRepoId = randomInt(1, 2 ** 47);
  const apiKey = `cs_live_test_${randomUUID()}`;
  const revokedApiKey = `cs_live_test_${randomUUID()}`;

  const seed: StoreSeed = {
    organizations: [{ organizationId, defaultConfidenceThreshold: 0.75 }],
    repositories: [
      {
        repositoryId,
        organizationId,
        githubInstallationId: randomUUID(),
        githubRepoId,
        fullName: `test-org/repo-${githubRepoId}`,
        reviewEnabled: true,
      },
    ],
    repositorySettings: [],
    repositoryAgentConfig: [],
    sessions: [],
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
  return { seed, ids: { organizationId, repositoryId, userId, keyId, githubRepoId }, apiKey, revokedApiKey };
}

type UniqueSeed = ReturnType<typeof uniqueSeed>;

/**
 * The behaviour every `Stores` implementation must share. `makeStores` builds stores holding exactly
 * `seed` (plus whatever unrelated rows already exist).
 */
export function describeStoresContract(makeStores: (seed: StoreSeed) => Promise<Stores>): void {
  async function build(edit: (s: UniqueSeed) => void = () => {}) {
    const unique = uniqueSeed();
    edit(unique);
    return { stores: await makeStores(unique.seed), ...unique };
  }

  describe("repositories", () => {
    it("finds a repository by GitHub repo id and misses an unknown one", async () => {
      const { stores, ids, seed } = await build();

      await expect(stores.repositories.findByGithubRepoId(ids.githubRepoId)).resolves.toEqual(seed.repositories[0]);
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
  });
}
