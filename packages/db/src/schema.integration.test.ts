import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { deleteSeededDatabase, SEED_IDS, seedMeaningfulDatabase } from "./seed-data.js";

// Needs a migrated database: CI sets TEST_DATABASE_URL to its Postgres service; locally it is opt-in.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("schema constraints (integration)", () => {
  let prisma: PrismaClient;
  const organizationId = randomUUID();
  const repositoryId = randomUUID();
  const suffix = Math.floor(Math.random() * 1e9);

  beforeAll(async () => {
    prisma = createPrismaClient(url!);
    await prisma.organization.create({
      data: { id: organizationId, githubOrgLogin: `test-org-${suffix}`, githubOrgId: BigInt(suffix), displayName: "Test" },
    });
    const installation = await prisma.githubInstallation.create({
      data: { organizationId, githubInstallationId: BigInt(suffix), accountLogin: `test-org-${suffix}` },
    });
    await prisma.repository.create({
      data: { id: repositoryId, organizationId, githubInstallationId: installation.id, githubRepoId: BigInt(suffix), fullName: `test-org-${suffix}/repo` },
    });
  });

  afterAll(async () => {
    // Cascades to the installation, repository and reviews.
    await prisma.organization.delete({ where: { id: organizationId } });
    await deleteSeededDatabase(prisma);
    await prisma.$disconnect();
  });

  const review = (trigger: "github_pull_request" | "dashboard_manual", prNumber: number | null) =>
    prisma.review.create({
      data: { organizationId, repositoryId, trigger, prNumber, headSha: "abc123", confidenceThreshold: 0.8 },
    });

  it("populates all 18 tables idempotently via seedMeaningfulDatabase", async () => {
    const first = await seedMeaningfulDatabase(prisma);
    const second = await seedMeaningfulDatabase(prisma);
    expect(second).toEqual(first);
    expect(first.counts.organizations).toBe(2);
    expect(first.counts.reviews).toBe(4);
    expect(first.counts.agentRuns).toBe(15);
    expect(first.counts.findings).toBe(12);
    expect(first.counts.suggestions).toBe(6);
    expect(first.counts.findingEmbeddings).toBe(4);
    expect(first.counts.findingSimilarities).toBe(2);

    const clubbed = await prisma.finding.findUniqueOrThrow({
      where: { id: SEED_IDS.findings.pr42SqlInjectionOrders },
      include: { duplicates: true, suggestions: true, similarFrom: true },
    });
    expect(clubbed.duplicateCount).toBe(2);
    expect(clubbed.duplicates).toHaveLength(1);
    expect(clubbed.suggestions[0]?.state).toBe("accepted");
    expect(clubbed.similarFrom[0]?.similarityScore.toNumber()).toBeCloseTo(0.924, 3);
  });

  it("rejects a second pull request review of the same commit (uq_reviews_pr_head)", async () => {
    await review("github_pull_request", 7);
    await expect(review("github_pull_request", 7)).rejects.toThrow();
  });

  it("allows repeated manual reviews of the same commit", async () => {
    await review("dashboard_manual", 7);
    await expect(review("dashboard_manual", 7)).resolves.toBeDefined();
  });

  it("requires a PR number for pull request reviews (ck_reviews_pr_number)", async () => {
    await expect(review("github_pull_request", null)).rejects.toThrow();
  });

  it("rejects a threshold outside 0..1 (ck_org_threshold)", async () => {
    await expect(
      prisma.organization.update({ where: { id: organizationId }, data: { defaultConfidenceThreshold: 1.5 } }),
    ).rejects.toThrow();
  });

  it("stores a full report as JSON and cancelled as a status", async () => {
    const created = await review("dashboard_manual", null);
    const updated = await prisma.review.update({
      where: { id: created.id },
      data: { status: "cancelled", report: { summary: { total: 0 } } },
    });
    expect(updated.status).toBe("cancelled");
    expect(updated.report).toEqual({ summary: { total: 0 } });
  });
});
