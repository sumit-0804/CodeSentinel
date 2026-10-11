import { createPrismaClient, type PrismaClient } from "@code-sentinel/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { deleteSeed, writeSeed } from "../test-support/prisma-seed.js";
import { describeStoresContract } from "../test-support/stores-contract.js";
import type { StoreSeed } from "./in-memory.js";
import { PrismaStores } from "./prisma-stores.js";

// Needs a migrated database: CI sets TEST_DATABASE_URL to its Postgres service; locally it is opt-in.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PrismaStores (integration)", () => {
  let prisma: PrismaClient;
  const written: StoreSeed[] = [];

  beforeAll(() => {
    prisma = createPrismaClient(url!);
  });
  afterEach(async () => {
    for (const seed of written.splice(0)) await deleteSeed(prisma, seed);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describeStoresContract(async (seed) => {
    written.push(seed);
    await writeSeed(prisma, seed);
    return new PrismaStores(prisma);
  });

  it("never returns a cs_session session, because Supabase owns sessions", async () => {
    await expect(new PrismaStores(prisma).sessions.findActiveByTokenHash("ab".repeat(32), new Date())).resolves.toBeUndefined();
  });
});
