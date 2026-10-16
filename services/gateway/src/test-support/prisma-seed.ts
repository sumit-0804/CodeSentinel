import { randomInt } from "node:crypto";

import type { Prisma, PrismaClient } from "@code-sentinel/db";

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
    const githubOrgId = org.githubOrgId ?? randomInt(1, 2 ** 47);
    await prisma.organization.create({
      data: {
        id: org.organizationId,
        githubOrgLogin: org.login ?? `test-org-${githubOrgId}`,
        githubOrgId: BigInt(githubOrgId),
        ...(org.accountType ? { accountType: org.accountType } : {}),
        displayName: org.displayName ?? displayNames.get(org.organizationId) ?? "Test Org",
        ...(org.defaultConfidenceThreshold !== undefined ? { defaultConfidenceThreshold: org.defaultConfidenceThreshold } : {}),      },
    });
  }
  for (const row of seed.organizationAgentDefaults) {
    await prisma.organizationAgentDefault.create({ data: row });
  }
  for (const installation of seed.installations) {
    await prisma.githubInstallation.create({
      data: {
        id: installation.installationId,
        organizationId: installation.organizationId,
        githubInstallationId: BigInt(installation.githubInstallationId),
        accountLogin: installation.accountLogin,
        suspendedAt: installation.suspendedAt ?? null,
        uninstalledAt: installation.uninstalledAt ?? null,
      },
    });
  }
  for (const repo of seed.repositories) {
    // A repository whose installation the seed doesn't list gets a placeholder one.
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
        ...(repo.useOrgDefaults !== undefined ? { useOrgDefaults: repo.useOrgDefaults } : {}),
        ...(repo.defaultBranch !== undefined ? { defaultBranch: repo.defaultBranch } : {}),
        ...(repo.isPrivate !== undefined ? { isPrivate: repo.isPrivate } : {}),
        primaryLanguage: repo.primaryLanguage ?? null,
        removedAt: repo.removedAt ?? null,
      },
    });
  }
  for (const { repositoryId, ...settings } of seed.repositorySettings) {
    await prisma.repositorySetting.create({ data: { repositoryId, ...settings } });
  }
  for (const config of seed.repositoryAgentConfig) {
    await prisma.repositoryAgentConfig.create({ data: config });
  }
  for (const review of seed.reviews) {
    await prisma.review.create({
      data: {
        id: review.reviewId,
        organizationId: review.organizationId,
        repositoryId: review.repositoryId,
        trigger: review.trigger,
        prNumber: review.prNumber ?? null,
        prTitle: review.prTitle ?? null,
        headSha: review.headSha,
        headRef: review.headRef ?? null,
        baseRef: review.baseRef ?? null,
        status: review.status,
        checkConclusion: review.checkConclusion ?? null,
        githubCheckRunId: review.githubCheckRunId !== undefined ? BigInt(review.githubCheckRunId) : null,
        jobId: review.jobId ?? null,
        confidenceThreshold: review.confidenceThreshold,
        durationMs: review.durationMs ?? null,
        createdAt: review.createdAt,
        ...(review.report ? { report: review.report as unknown as Prisma.InputJsonValue } : {}),
      },
    });
  }
  for (const user of seed.users) {
    await prisma.user.create({
      data: {
        id: user.userId,
        githubUserId: user.githubUserId !== undefined ? BigInt(user.githubUserId) : null,
        githubLogin: user.githubLogin ?? null,
        email: user.email ?? null,
        name: user.name ?? null,
        avatarUrl: user.avatarUrl ?? null,
        memberships: { create: user.memberships.map((m) => ({ organizationId: m.organizationId, role: m.role })) },
      },
    });
  }
  for (const { userId, ...tokens } of seed.githubTokens) {
    await prisma.githubUserToken.create({
      data: {
        userId,
        accessTokenSealed: tokens.accessTokenSealed,
        refreshTokenSealed: tokens.refreshTokenSealed ?? null,
        expiresAt: tokens.expiresAt ?? null,
        refreshExpiresAt: tokens.refreshExpiresAt ?? null,
      },
    });
  }
  // Each suggestion with the finding and agent run it hangs from, after users so `resolved_by_user_id` resolves.
  for (const s of seed.suggestions) {
    const run = await prisma.agentRun.create({ data: { reviewId: s.reviewId, agent: s.agent, status: "succeeded", timeoutMs: 20000 } });
    await prisma.finding.create({
      data: {
        id: s.findingId,
        reviewId: s.reviewId,
        agentRunId: run.id,
        agent: s.agent,
        ruleId: s.ruleId,
        title: s.title,
        description: "",
        filePath: s.filePath,
        lineStart: s.lineStart,
        lineEnd: s.lineEnd,
        severity: "critical",
        confidence: 0.9,
        severityRank: 1,
        dedupeKey: s.findingId.replaceAll("-", ""),
      },
    });
    await prisma.suggestion.create({
      data: {
        id: s.suggestionId,
        findingId: s.findingId,
        kind: s.kind,
        state: s.state,
        originalSnippet: s.originalSnippet,
        suggestedSnippet: s.suggestedSnippet,
        postedToGithub: s.postedToGithub ?? false,
        githubCommentId: s.githubCommentId !== undefined ? BigInt(s.githubCommentId) : null,
        resolvedByUserId: s.resolvedByUserId ?? null,
        resolvedAt: s.resolvedAt ?? null,
        resolutionCommitSha: s.resolutionCommitSha ?? null,
        rejectionReason: s.rejectionReason ?? null,
        rejectionComment: s.rejectionComment ?? null,
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
