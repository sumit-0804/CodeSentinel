import { EXAMPLE_REPOSITORY_ID } from "@code-sentinel/contracts/examples";
import { describe, expect, it } from "vitest";

import { baseSeed, seededStores, TEST_API_KEY_ID, TEST_GITHUB_REPO_ID } from "../test-support/fixtures.js";
import { InMemoryStores, type StoreSeed } from "./in-memory.js";

const NOW = new Date();

function stores(edit: (seed: StoreSeed) => void = () => {}) {
  const seed = baseSeed();
  edit(seed);
  return new InMemoryStores(seed);
}

describe("InMemoryStores", () => {
  it("finds a repository by GitHub repo id and misses an unknown one", async () => {
    const { repositories } = stores();

    await expect(repositories.findByGithubRepoId(TEST_GITHUB_REPO_ID)).resolves.toMatchObject({
      repositoryId: EXAMPLE_REPOSITORY_ID,
      reviewEnabled: true,
    });
    await expect(repositories.findByGithubRepoId(987654321)).resolves.toBeUndefined();
  });

  it("uses the repository override when one is set", async () => {
    const { repositoryConfig } = stores((seed) => {
      seed.organizations[0]!.defaultConfidenceThreshold = 0.7;
      seed.repositorySettings.push({ repositoryId: EXAMPLE_REPOSITORY_ID, confidenceThresholdOverride: 0.9 });
    });

    await expect(repositoryConfig.getEffectiveConfig(EXAMPLE_REPOSITORY_ID)).resolves.toMatchObject({
      confidenceThreshold: 0.9,
      thresholdSource: "repository_override",
    });
  });

  it("falls back to the organization default when the override is null", async () => {
    const { repositoryConfig } = stores((seed) => {
      seed.organizations[0]!.defaultConfidenceThreshold = 0.7;
      seed.repositorySettings.push({ repositoryId: EXAMPLE_REPOSITORY_ID, confidenceThresholdOverride: null });
    });

    await expect(repositoryConfig.getEffectiveConfig(EXAMPLE_REPOSITORY_ID)).resolves.toMatchObject({
      confidenceThreshold: 0.7,
      thresholdSource: "organization_default",
    });
  });

  it("falls back to the 0.8 platform default and the schema.sql settings defaults", async () => {
    const { repositoryConfig } = stores();

    await expect(repositoryConfig.getEffectiveConfig(EXAMPLE_REPOSITORY_ID)).resolves.toEqual({
      enabledAgents: ["security", "style", "performance", "logic", "documentation"],
      confidenceThreshold: 0.8,
      thresholdSource: "platform_default",
      agentTimeoutMs: 20000,
      autoFixStyle: true,
      postInlineComments: true,
    });
  });

  it("drops a disabled agent and keeps the rest in contract order", async () => {
    const { repositoryConfig } = stores((seed) => {
      seed.repositoryAgentConfig.push(
        { repositoryId: EXAMPLE_REPOSITORY_ID, agent: "documentation", enabled: true },
        { repositoryId: EXAMPLE_REPOSITORY_ID, agent: "style", enabled: false },
      );
    });

    const config = await repositoryConfig.getEffectiveConfig(EXAMPLE_REPOSITORY_ID);

    expect(config?.enabledAgents).toEqual(["security", "performance", "logic", "documentation"]);
  });

  it("never returns expired or revoked sessions or revoked API keys", async () => {
    const { stores: active, seed } = await seededStores();
    const session = seed.sessions[0]!;
    const key = seed.apiKeys.find((k) => k.keyId === TEST_API_KEY_ID)!;
    await expect(active.sessions.findActiveByTokenHash(session.tokenHash, NOW)).resolves.toBeDefined();
    await expect(active.apiKeys.findActiveByKeyHash(key.keyHash)).resolves.toBeDefined();

    const expired = await seededStores((s) => {
      s.sessions[0]!.expiresAt = new Date(NOW.getTime() - 1000);
    });
    const revoked = await seededStores((s) => {
      s.sessions[0]!.revokedAt = new Date(NOW.getTime() - 1000);
      s.apiKeys.find((k) => k.keyId === TEST_API_KEY_ID)!.revokedAt = new Date(NOW.getTime() - 1000);
    });

    await expect(expired.stores.sessions.findActiveByTokenHash(expired.seed.sessions[0]!.tokenHash, NOW)).resolves.toBeUndefined();
    await expect(revoked.stores.sessions.findActiveByTokenHash(revoked.seed.sessions[0]!.tokenHash, NOW)).resolves.toBeUndefined();
    await expect(revoked.stores.apiKeys.findActiveByKeyHash(key.keyHash)).resolves.toBeUndefined();
  });
});
