// Dev-only demo data, the database twin of services/gateway/src/persistence/dev-seed.ts. Idempotent.
import "dotenv/config";

import { createPrismaClient } from "../src/client.js";

// Same ids as `@code-sentinel/contracts/examples` and the gateway's in-memory dev seed.
const ORGANIZATION_ID = "7d9e1f2a-3b4c-4d5e-8f60-718293a4b5c6";
const REPOSITORY_ID = "2b0c6b0e-0b1a-4f6e-9c3d-1a2b3c4d5e6f";
const INSTALLATION_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const USER_ID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (packages/db/.env)");
if (process.env.NODE_ENV === "production") throw new Error("the dev seed must never run in production");

// Optional `owner/name:githubRepoId` (same format as the gateway's GATEWAY_DEV_REPOSITORY), e.g. the test playground.
const repoOverride = process.env.SEED_GITHUB_REPOSITORY?.trim();
if (repoOverride && !/^[\w.-]+\/[\w.-]+:\d+$/.test(repoOverride)) {
  throw new Error("SEED_GITHUB_REPOSITORY must look like owner/name:githubRepoId");
}
const [fullName, githubRepoId] = repoOverride
  ? [repoOverride.split(":")[0]!, BigInt(repoOverride.split(":")[1]!)]
  : ["code-sentinel/consumer-api", 123456789n];

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
// The update also sets the repo, so rerunning with or without SEED_GITHUB_REPOSITORY switches it.
await prisma.repository.upsert({
  where: { id: REPOSITORY_ID },
  update: { githubRepoId, fullName },
  create: {
    id: REPOSITORY_ID,
    organizationId: ORGANIZATION_ID,
    githubInstallationId: INSTALLATION_ID,
    githubRepoId,
    fullName,
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
await prisma.$disconnect();
process.stdout.write(`dev seed applied (repository ${fullName})\n`);
