import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import type { PrismaClient } from "./generated/prisma/client.js";

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
    await prisma.$disconnect();
  });

  const review = (trigger: "github_pull_request" | "dashboard_manual", prNumber: number | null) =>
    prisma.review.create({
      data: { organizationId, repositoryId, trigger, prNumber, headSha: "abc123", confidenceThreshold: 0.8 },
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
