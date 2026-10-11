import { createPrismaClient } from "@code-sentinel/db";
import { afterAll, afterEach, describe } from "vitest";

import { deleteSeed, installSessionStandIn, writeSeed } from "../test-support/prisma-seed.js";
import { describeStoresContract } from "../test-support/stores-contract.js";
import type { StoreSeed } from "./in-memory.js";
import { PrismaStores } from "./prisma-stores.js";

// Needs a migrated database: CI sets TEST_DATABASE_URL to its Postgres service; locally it is opt-in.
const url = process.env.TEST_DATABASE_URL;
const prisma = url ? createPrismaClient(url) : undefined;
// Decided before the suite is collected, because it switches the session cases on or off.
const sessions = prisma ? await installSessionStandIn(prisma) : false;

describe.skipIf(!prisma)("PrismaStores (integration)", () => {
  const db = prisma!;
  const written: StoreSeed[] = [];

  afterEach(async () => {
    for (const seed of written.splice(0)) await deleteSeed(db, seed, { sessions });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  describeStoresContract(
    async (seed) => {
      written.push(seed);
      await writeSeed(db, seed, { sessions });
      return new PrismaStores(db);
    },
    {
      sessions,
      cleanUp: async (userId) => {
        await db.user.deleteMany({ where: { id: userId } });
      },
    },
  );
});
