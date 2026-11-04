// Dev-only demo data, the database twin of services/gateway/src/persistence/dev-seed.ts
// extended with realistic records across all 18 tables. Idempotent.
import "dotenv/config";

import { createPrismaClient } from "../src/client.js";
import { seedMeaningfulDatabase } from "../src/seed-data.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (packages/db/.env)");
if (process.env.NODE_ENV === "production") throw new Error("the dev seed must never run in production");

const prisma = createPrismaClient(url);
try {
  const summary = await seedMeaningfulDatabase(prisma, {
    repoOverride: process.env.SEED_GITHUB_REPOSITORY,
    encryptionKey: process.env.FIELD_ENCRYPTION_KEY,
  });
  const totalRecords = Object.values(summary.counts).reduce((sum, count) => sum + count, 0);
  process.stdout.write(
    `dev seed applied (repository ${summary.primaryRepository}; ${totalRecords} records across 18 tables)\n`,
  );
} finally {
  await prisma.$disconnect();
}
