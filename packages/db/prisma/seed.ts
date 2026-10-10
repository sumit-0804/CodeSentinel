// Dev-only demo data, the database twin of services/gateway/src/persistence/dev-seed.ts. Idempotent.
import "dotenv/config";
import { createHash } from "node:crypto";

import { createPrismaClient } from "../src/client.js";

// Same ids as `@code-sentinel/contracts/examples` and the gateway's in-memory dev seed.
const ORGANIZATION_ID = "7d9e1f2a-3b4c-4d5e-8f60-718293a4b5c6";
const REPOSITORY_ID = "2b0c6b0e-0b1a-4f6e-9c3d-1a2b3c4d5e6f";
const INSTALLATION_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const USER_ID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const API_KEY_ID = "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9";
/** Local-only key for the gateway's manual check; it is published in the repo, so dev data only. */
const DEV_API_KEY = "cs_live_dev_00000000";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (packages/db/.env)");
if (process.env.NODE_ENV === "production") throw new Error("the dev seed must never run in production");

const prisma = createPrismaClient(url);

await prisma.organization.upsert({
  where: { id: ORGANIZATION_ID },
  update: {},
  create: { id: ORGANIZATION_ID, githubOrgLogin: "code-sentinel", githubOrgId: 1n, displayName: "Code Sentinel" },
});
await prisma.githubInstallation.upsert({
  where: { id: INSTALLATION_ID },
  update: {},
  create: { id: INSTALLATION_ID, organizationId: ORGANIZATION_ID, githubInstallationId: 1n, accountLogin: "code-sentinel" },
});
await prisma.repository.upsert({
  where: { id: REPOSITORY_ID },
  update: {},
  create: {
    id: REPOSITORY_ID,
    organizationId: ORGANIZATION_ID,
    githubInstallationId: INSTALLATION_ID,
    githubRepoId: 123456789n,
    fullName: "code-sentinel/consumer-api",
    settings: { create: {} },
  },
});
await prisma.user.upsert({
  where: { id: USER_ID },
  update: {},
  create: { id: USER_ID, githubLogin: "octo-dev", email: "octo-dev@example.test", name: "Octo Dev" },
});
await prisma.organizationMember.upsert({
  where: { organizationId_userId: { organizationId: ORGANIZATION_ID, userId: USER_ID } },
  update: {},
  create: { organizationId: ORGANIZATION_ID, userId: USER_ID, role: "admin" },
});
await prisma.apiKey.upsert({
  where: { id: API_KEY_ID },
  update: {},
  create: {
    id: API_KEY_ID,
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    label: "Local development",
    keyPrefix: DEV_API_KEY.slice(0, 12),
    keyHash: createHash("sha256").update(DEV_API_KEY, "utf8").digest(),
  },
});

await prisma.$disconnect();
process.stdout.write("dev seed applied\n");
