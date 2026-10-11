import { EXAMPLE_REPOSITORY_ID } from "@code-sentinel/contracts/examples";
import { describe, expect, it } from "vitest";

import { baseSeed, seededStores } from "../test-support/fixtures.js";
import { describeStoresContract } from "../test-support/stores-contract.js";
import { devSeed } from "./dev-seed.js";
import { InMemoryStores } from "./in-memory.js";

const NOW = new Date();

describe("InMemoryStores", () => {
  describeStoresContract(async (seed) => new InMemoryStores(seed));

  // The database always has an organization default (NOT NULL DEFAULT 0.800), so only memory reaches this.
  it("falls back to the 0.8 platform default without an organization default", async () => {
    const { repositoryConfig } = new InMemoryStores(baseSeed());

    await expect(repositoryConfig.getEffectiveConfig(EXAMPLE_REPOSITORY_ID)).resolves.toMatchObject({
      confidenceThreshold: 0.8,
      thresholdSource: "platform_default",
    });
  });

  it("never returns expired or revoked sessions", async () => {
    const { stores: active, seed } = await seededStores();
    await expect(active.sessions.findActiveByTokenHash(seed.sessions[0]!.tokenHash, NOW)).resolves.toBeDefined();

    const expired = await seededStores((s) => {
      s.sessions[0]!.expiresAt = new Date(NOW.getTime() - 1000);
    });
    const revoked = await seededStores((s) => {
      s.sessions[0]!.revokedAt = new Date(NOW.getTime() - 1000);
    });

    await expect(expired.stores.sessions.findActiveByTokenHash(expired.seed.sessions[0]!.tokenHash, NOW)).resolves.toBeUndefined();
    await expect(revoked.stores.sessions.findActiveByTokenHash(revoked.seed.sessions[0]!.tokenHash, NOW)).resolves.toBeUndefined();
  });
});

describe("devSeed", () => {
  it("points the seeded repository at GATEWAY_DEV_REPOSITORY when given", () => {
    const { seed } = devSeed({ repository: { fullName: "octo/playground", githubRepoId: 42 } });

    expect(seed.repositories[0]).toMatchObject({ fullName: "octo/playground", githubRepoId: 42 });
    expect(devSeed().seed.repositories[0]).toMatchObject({ fullName: "code-sentinel/consumer-api", githubRepoId: 123456789 });
  });
});
