import { randomInt } from "node:crypto";

import type { PrismaClient } from "@code-sentinel/db";

import type { StoreSeed } from "../persistence/in-memory.js";

/**
 * A test database has no Supabase `auth` schema, so it gets a stand-in `private.session_is_active`
 * backed by `private.test_sessions`. A database that already has the real function is left alone;
 * then `false` is returned and active sessions cannot be seeded.
 */
export async function installSessionStandIn(prisma: PrismaClient): Promise<boolean> {
  const [fn] = await prisma.$queryRaw<{ exists: boolean }[]>`select to_regprocedure('private.session_is_active(uuid)') is not null as exists`;
  if (fn?.exists) {
    const [table] = await prisma.$queryRaw<{ exists: boolean }[]>`select to_regclass('private.test_sessions') is not null as exists`;
    return table?.exists === true;
  }
  await prisma.$executeRawUnsafe(`create schema if not exists private`);
  await prisma.$executeRawUnsafe(`create table if not exists private.test_sessions (id uuid primary key)`);
  await prisma.$executeRawUnsafe(
    `create function private.session_is_active(session_id uuid) returns boolean language sql stable
     as $$ select exists (select 1 from private.test_sessions where id = session_id) $$`,
  );
  return true;
}

/** Writes a `StoreSeed` as database rows. Logins and GitHub ids are random, so seeds never collide. */
export async function writeSeed(prisma: PrismaClient, seed: StoreSeed, { sessions = false } = {}): Promise<void> {
  if (sessions) {
    for (const id of seed.activeSessionIds) await prisma.$executeRaw`insert into private.test_sessions (id) values (${id}::uuid)`;
  }
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
        name: user.name ?? null,
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
export async function deleteSeed(prisma: PrismaClient, seed: StoreSeed, { sessions = false } = {}): Promise<void> {
  if (sessions && seed.activeSessionIds.length > 0) {
    await prisma.$executeRaw`delete from private.test_sessions where id = any(${seed.activeSessionIds}::uuid[])`;
  }
  await prisma.organization.deleteMany({ where: { id: { in: seed.organizations.map((o) => o.organizationId) } } });
  await prisma.user.deleteMany({ where: { id: { in: seed.users.map((u) => u.userId) } } });
}
