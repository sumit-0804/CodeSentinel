import { randomInt } from "node:crypto";

import type { PrismaClient } from "@code-sentinel/db";

import type { StoreSeed } from "../persistence/in-memory.js";

/** Writes a `StoreSeed` as database rows. Logins and GitHub ids are random, so seeds never collide. */
export async function writeSeed(prisma: PrismaClient, seed: StoreSeed): Promise<void> {
  const displayNames = new Map(seed.users.flatMap((u) => u.memberships).map((m) => [m.organizationId, m.displayName]));

  for (const org of seed.organizations) {
    const githubOrgId = randomInt(1, 2 ** 47);
    await prisma.organization.create({
      data: {
        id: org.organizationId,
        githubOrgLogin: `test-org-${githubOrgId}`,
        githubOrgId: BigInt(githubOrgId),
        displayName: displayNames.get(org.organizationId) ?? "Test Org",
        ...(org.defaultConfidenceThreshold !== undefined ? { defaultConfidenceThreshold: org.defaultConfidenceThreshold } : {}),
      },
    });
  }
  for (const repo of seed.repositories) {
    await prisma.githubInstallation.upsert({
      where: { id: repo.githubInstallationId },
      update: {},
      create: {
        id: repo.githubInstallationId,
        organizationId: repo.organizationId,
        githubInstallationId: BigInt(randomInt(1, 2 ** 47)),
        accountLogin: "test-org",
      },
    });
    await prisma.repository.create({
      data: {
        id: repo.repositoryId,
        organizationId: repo.organizationId,
        githubInstallationId: repo.githubInstallationId,
        githubRepoId: BigInt(repo.githubRepoId),
        fullName: repo.fullName,
        reviewEnabled: repo.reviewEnabled,
      },
    });
  }
  for (const { repositoryId, ...settings } of seed.repositorySettings) {
    await prisma.repositorySetting.create({ data: { repositoryId, ...settings } });
  }
  for (const config of seed.repositoryAgentConfig) {
    await prisma.repositoryAgentConfig.create({ data: config });
  }
  for (const user of seed.users) {
    await prisma.user.create({
      data: {
        id: user.userId,
        githubLogin: user.githubLogin ?? null,
        email: user.email ?? null,
        avatarUrl: user.avatarUrl ?? null,
        memberships: { create: user.memberships.map((m) => ({ organizationId: m.organizationId, role: m.role })) },
      },
    });
  }
  for (const key of seed.apiKeys) {
    await prisma.apiKey.create({
      data: {
        id: key.keyId,
        userId: key.userId,
        organizationId: key.organizationId,
        label: key.label,
        keyPrefix: key.keyPrefix,
        keyHash: Buffer.from(key.keyHash, "hex"),
        revokedAt: key.revokedAt ?? null,
        lastUsedAt: key.lastUsedAt ?? null,
      },
    });
  }
}

/** Removes what `writeSeed` wrote; deleting organizations and users cascades to everything else. */
export async function deleteSeed(prisma: PrismaClient, seed: StoreSeed): Promise<void> {
  await prisma.organization.deleteMany({ where: { id: { in: seed.organizations.map((o) => o.organizationId) } } });
  await prisma.user.deleteMany({ where: { id: { in: seed.users.map((u) => u.userId) } } });
}
