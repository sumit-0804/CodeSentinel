import { EXAMPLE_REPOSITORY_ID } from "@code-sentinel/contracts/examples";
import { describe, expect, it } from "vitest";

import { baseSeed } from "../test-support/fixtures.js";
import { describeStoresContract } from "../test-support/stores-contract.js";
import { devSeed } from "./dev-seed.js";
import { InMemoryStores } from "./in-memory.js";

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
});

describe("devSeed", () => {
  it("points the seeded repository at GATEWAY_DEV_REPOSITORY when given", () => {
    const { seed } = devSeed({ repository: { fullName: "octo/playground", githubRepoId: 42 } });

    expect(seed.repositories[0]).toMatchObject({ fullName: "octo/playground", githubRepoId: 42 });
    expect(devSeed().seed.repositories[0]).toMatchObject({ fullName: "code-sentinel/consumer-api", githubRepoId: 123456789 });
  });
});
