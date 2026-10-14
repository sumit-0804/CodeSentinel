import { randomInt, randomUUID } from "node:crypto";

import type { CombinedReport, Finding } from "@code-sentinel/contracts";
import { createPrismaClient, type PrismaClient } from "@code-sentinel/db";
import { noopLogger } from "@code-sentinel/service-kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { describeJobStoreContract, freshRequest, queuedJob } from "../test-support/job-store-contract.js";
import { PrismaJobStore } from "./prisma-job-store.js";
import { ReviewJobController } from "./review-job-controller.js";

// Needs a migrated database: CI sets TEST_DATABASE_URL to its Postgres service; locally it is opt-in.
const url = process.env.TEST_DATABASE_URL;

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function finding(overrides: Partial<Finding>): Finding {
  return {
    agent: "security",
    ruleId: "security/sql-injection",
    title: "SQL injection",
    description: "User input reaches a SQL string.",
    location: { filePath: "app/payments.py", lineStart: 12, lineEnd: 12 },
    severity: "critical",
    confidence: 0.95,
    ...overrides,
  };
}

describe.skipIf(!url)("PrismaJobStore (integration)", () => {
  let prisma: PrismaClient;
  const organizationId = randomUUID();
  const repositoryId = randomUUID();
  const request = (overrides = {}) => freshRequest({ organizationId, repositoryId }, overrides);

  beforeAll(async () => {
    prisma = createPrismaClient(url!);
    const githubId = randomInt(1, 2 ** 47);
    await prisma.organization.create({
      data: { id: organizationId, githubOrgLogin: `test-org-${githubId}`, githubOrgId: BigInt(githubId), displayName: "Test" },
    });
    const installation = await prisma.githubInstallation.create({
      data: { organizationId, githubInstallationId: BigInt(githubId), accountLogin: "test-org" },
    });
    await prisma.repository.create({
      data: {
        id: repositoryId,
        organizationId,
        githubInstallationId: installation.id,
        githubRepoId: BigInt(githubId),
        fullName: `test-org/repo-${githubId}`,
      },
    });
  });

  afterAll(async () => {
    // Cascades to the repository, its reviews and their rows.
    await prisma?.organization.deleteMany({ where: { id: organizationId } });
    await prisma?.$disconnect();
  });

  describeJobStoreContract(async () => ({ store: new PrismaJobStore(prisma, { llmAgentTimeoutMs: 45000 }), request }));

  it("writes the review row from the request", async () => {
    const store = new PrismaJobStore(prisma);
    const job = queuedJob();
    const req = request({ confidenceThreshold: undefined });

    await store.insert(job, req, `delivery-${randomUUID()}`);

    const row = await prisma.review.findUniqueOrThrow({ where: { id: job.reviewId } });
    expect(row).toMatchObject({
      jobId: job.jobId,
      organizationId,
      repositoryId,
      trigger: "github_pull_request",
      prNumber: req.pullRequest?.number,
      headSha: req.headSha,
      changedFilesCount: req.files.length + (req.skippedFiles?.length ?? 0),
      status: "queued",
    });
    expect(row.changedLinesCount).toBeGreaterThan(0);
    expect(row.confidenceThreshold.toNumber()).toBe(0.8);
  });

  it("writes agent runs, findings and suggestions when a review completes", async () => {
    const store = new PrismaJobStore(prisma, { llmAgentTimeoutMs: 45000 });
    const job = queuedJob();
    const req = request({ agentTimeoutMs: 20000 });
    await store.insert(job, req);
    const report: CombinedReport = {
      reviewId: job.reviewId,
      status: "completed",
      summary: { criticalCount: 1, warningCount: 1, infoCount: 1, autoFixedCount: 0, suggestedFixCount: 1 },
      findings: [
        finding({
          duplicateCount: 2,
          suggestion: { kind: "ai_suggested", originalSnippet: "f'... {c}'", suggestedSnippet: "'... ?', (c,)" },
        }),
        finding({ ruleId: "security/xss", severity: "warning", confidence: 0.7, location: { filePath: "web/cart.js", lineStart: 18, lineEnd: 18 } }),
        finding({ agent: "style", ruleId: "style/prettier", severity: "info", confidence: 1, location: { filePath: "web/cart.js", lineStart: 6, lineEnd: 8 } }),
      ],
      agentRuns: [
        { agent: "security", status: "succeeded", findingsCount: 2, latencyMs: 2100, llmProvider: "groq" },
        { agent: "style", status: "succeeded", findingsCount: 1, latencyMs: 900 },
      ],
      durationMs: 2300,
    };

    await store.complete({ ...job, status: "completed", completedAt: "2026-10-11T10:00:09.000Z", agentRuns: report.agentRuns, report }, req);

    const runs = await prisma.agentRun.findMany({ where: { reviewId: job.reviewId }, orderBy: { agent: "asc" } });
    expect(runs.map((r) => [r.agent, r.status, r.timeoutMs, r.llmProvider])).toEqual([
      ["security", "succeeded", 45000, "groq"],
      ["style", "succeeded", 20000, null],
    ]);
    const rows = await prisma.finding.findMany({ where: { reviewId: job.reviewId }, include: { suggestions: true }, orderBy: { severityRank: "asc" } });
    expect(rows.map((f) => [f.ruleId, f.severityRank, f.duplicateCount, f.agentRunId === runs.find((r) => r.agent === f.agent)?.id])).toEqual([
      ["security/sql-injection", 1, 2, true],
      ["security/xss", 2, 1, true],
      ["style/prettier", 3, 1, true],
    ]);
    expect(rows.every((f) => /^[0-9a-f]{40}$/.test(f.dedupeKey))).toBe(true);
    expect(rows[0]?.suggestions).toMatchObject([{ kind: "ai_suggested", state: "proposed" }]);
    const review = await prisma.review.findUniqueOrThrow({ where: { id: job.reviewId } });
    expect(review).toMatchObject({ status: "completed", durationMs: 2300 });
    expect(review.report).toEqual(report);
  });

  it("marks older reviews' undecided fixes of the same pull request superseded when a newer review completes", async () => {
    const store = new PrismaJobStore(prisma);
    const withFix = (reviewId: string): CombinedReport => ({
      reviewId,
      status: "completed",
      summary: { criticalCount: 1, warningCount: 0, infoCount: 0, autoFixedCount: 0, suggestedFixCount: 1 },
      findings: [finding({ suggestion: { kind: "ai_suggested", originalSnippet: "a", suggestedSnippet: "b" } })],
      agentRuns: [{ agent: "security", status: "succeeded", findingsCount: 1, latencyMs: 10 }],
    });
    const finish = async (job: ReturnType<typeof queuedJob>, req: ReturnType<typeof request>) => {
      await store.insert(job, req);
      await store.complete({ ...job, status: "completed", completedAt: job.createdAt, report: withFix(job.reviewId) }, req);
    };
    const suggestionStates = async (reviewId: string) =>
      (await prisma.suggestion.findMany({ where: { finding: { reviewId } }, select: { state: true } })).map((s) => s.state);

    const pr = randomInt(1, 1_000_000);
    const older = queuedJob({ createdAt: "2026-10-11T09:00:00.000Z" });
    const otherPr = queuedJob({ createdAt: "2026-10-11T09:30:00.000Z" });
    const newer = queuedJob({ createdAt: "2026-10-11T10:00:00.000Z" });
    await finish(older, request({ pullRequest: { ...request().pullRequest!, number: pr } }));
    await finish(otherPr, request());
    await finish(newer, request({ pullRequest: { ...request().pullRequest!, number: pr } }));

    await expect(suggestionStates(older.reviewId)).resolves.toEqual(["superseded"]);
    await expect(suggestionStates(otherPr.reviewId)).resolves.toEqual(["proposed"]);
    await expect(suggestionStates(newer.reviewId)).resolves.toEqual(["proposed"]);
  });

  it("takes the duration from the job's timestamps when the report has none", async () => {
    const store = new PrismaJobStore(prisma);
    const job = queuedJob();
    await store.insert(job, request());
    await store.markRunning(job.jobId, "2026-10-11T10:00:01.000Z");

    await store.complete({ ...job, status: "failed", startedAt: "2026-10-11T10:00:01.000Z", completedAt: "2026-10-11T10:00:04.500Z" });

    const review = await prisma.review.findUniqueOrThrow({ where: { id: job.reviewId } });
    expect(review.durationMs).toBe(3500);
  });

  it("serves a finished review to a new process after a restart", async () => {
    const report: CombinedReport = {
      reviewId: "",
      status: "completed",
      summary: { criticalCount: 0, warningCount: 0, infoCount: 0, autoFixedCount: 0, suggestedFixCount: 0 },
      findings: [],
      agentRuns: [{ agent: "style", status: "succeeded", findingsCount: 0, latencyMs: 10 }],
    };
    const before = new ReviewJobController({
      run: async (input) => ({ ...report, reviewId: input.reviewId }),
      store: new PrismaJobStore(prisma),
      logger: noopLogger,
    });
    const { job } = await before.createJob(request());
    for (let i = 0; i < 40 && (await before.getJob(job.jobId))?.status !== "completed"; i++) await settle();

    // A new client stands in for the restarted orchestrator.
    const restarted = createPrismaClient(url!);
    try {
      const after = new ReviewJobController({ run: async () => report, store: new PrismaJobStore(restarted), logger: noopLogger });
      await expect(after.getJob(job.jobId)).resolves.toMatchObject({
        jobId: job.jobId,
        reviewId: job.reviewId,
        status: "completed",
        report: { ...report, reviewId: job.reviewId },
      });
    } finally {
      await restarted.$disconnect();
    }
  });
});
