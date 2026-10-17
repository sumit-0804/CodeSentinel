import { randomBytes, randomInt, randomUUID } from "node:crypto";

import type { Finding } from "@code-sentinel/contracts";
import { createPrismaClient, type PrismaClient } from "@code-sentinel/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PgVectorRepository, type Embedder } from "./pgvector-repository.js";
import type { StoredFinding } from "./vector-repository.js";

// Needs a migrated pgvector database: CI sets TEST_DATABASE_URL to its Postgres service; locally it is opt-in.
const url = process.env.TEST_DATABASE_URL;

/** A unit vector mostly along axis 0, tilted towards axis 1 by `tilt`: cosine to axis 0 is 1/sqrt(1+tilt²). */
function vector(tilt: number): number[] {
  const values = new Array<number>(768).fill(0);
  const norm = Math.sqrt(1 + tilt * tilt);
  values[0] = 1 / norm;
  values[1] = tilt / norm;
  return values;
}

// Titles pick the vector: "SQL" ones point the same way, "Unrelated" is about 0.55 away.
const VECTORS: Record<string, number[]> = {
  "SQL injection": vector(0),
  "SQL built from input": vector(0.3),
  "Unrelated naming issue": vector(1.5),
};

const embedder: Embedder & { calls: number } = {
  calls: 0,
  async embedMany(texts) {
    this.calls += texts.length;
    return texts.map((text) => {
      const title = text.split("\n")[1] ?? "";
      const found = VECTORS[title];
      if (!found) throw new Error(`no test vector for "${title}"`);
      return found;
    });
  },
};

function finding(title: string, overrides: Partial<Finding> = {}): StoredFinding {
  return {
    id: randomUUID(),
    agent: "security",
    ruleId: "security/sql-injection",
    title,
    description: "User input reaches a SQL string.",
    location: { filePath: "app/payments.py", lineStart: 12, lineEnd: 12 },
    severity: "critical",
    confidence: 0.95,
    ...overrides,
  };
}

describe.skipIf(!url)("PgVectorRepository (integration)", () => {
  let prisma: PrismaClient;
  let vectors: PgVectorRepository;
  const orgs = [randomUUID(), randomUUID()];
  const repos = [randomUUID(), randomUUID()];

  // Rows are written directly, not through PrismaJobStore: its integration test fails every queued review it sees.
  async function createReview(org: number, prNumber: number): Promise<{ reviewId: string; agentRunId: string }> {
    const review = await prisma.review.create({
      data: {
        organizationId: orgs[org]!,
        repositoryId: repos[org]!,
        trigger: "github_pull_request",
        prNumber,
        headSha: randomBytes(20).toString("hex"),
        status: "completed",
        confidenceThreshold: 0.8,
        agentRuns: { create: [{ agent: "security", status: "succeeded", timeoutMs: 45000 }] },
      },
      include: { agentRuns: true },
    });
    return { reviewId: review.id, agentRunId: review.agentRuns[0]!.id };
  }

  async function addFindings(reviewId: string, agentRunId: string, findings: StoredFinding[]): Promise<void> {
    for (const f of findings) {
      await prisma.finding.create({
        data: {
          id: f.id,
          reviewId,
          agentRunId,
          agent: f.agent,
          ruleId: f.ruleId,
          title: f.title,
          description: f.description,
          filePath: f.location.filePath,
          lineStart: f.location.lineStart,
          lineEnd: f.location.lineEnd,
          severity: f.severity,
          confidence: f.confidence,
          severityRank: 1,
          dedupeKey: randomBytes(20).toString("hex"),
          ...(f.suggestion
            ? { suggestions: { create: [{ kind: f.suggestion.kind, originalSnippet: f.suggestion.originalSnippet, suggestedSnippet: f.suggestion.suggestedSnippet }] } }
            : {}),
        },
      });
    }
  }

  /** A finished review of `prNumber` whose findings are indexed, as the orchestrator does after storing it. */
  async function reviewed(org: number, prNumber: number, findings: StoredFinding[]): Promise<string> {
    const { reviewId, agentRunId } = await createReview(org, prNumber);
    await addFindings(reviewId, agentRunId, findings);
    for (const f of findings) await vectors.index(f, orgs[org]!);
    return reviewId;
  }

  beforeAll(async () => {
    prisma = createPrismaClient(url!);
    vectors = new PgVectorRepository(prisma, { embedder, embeddingModel: "test-embedding" });
    for (const [i, organizationId] of orgs.entries()) {
      const githubId = randomInt(1, 2 ** 47);
      await prisma.organization.create({
        data: { id: organizationId, githubOrgLogin: `vec-org-${githubId}`, githubOrgId: BigInt(githubId), displayName: "Vectors" },
      });
      const installation = await prisma.githubInstallation.create({
        data: { organizationId, githubInstallationId: BigInt(githubId), accountLogin: "vec-org" },
      });
      await prisma.repository.create({
        data: { id: repos[i]!, organizationId, githubInstallationId: installation.id, githubRepoId: BigInt(githubId), fullName: `vec-org/repo-${i}` },
      });
    }
  });

  afterAll(async () => {
    await prisma?.organization.deleteMany({ where: { id: { in: orgs } } });
    await prisma?.$disconnect();
  });

  it("finds close past issues of the same organization, once per pull request, with how they ended", async () => {
    const fixed = finding("SQL injection", { suggestion: { kind: "deterministic", originalSnippet: "a", suggestedSnippet: "b" } });
    await reviewed(0, 11, [fixed, finding("Unrelated naming issue", { ruleId: "logic/naming" })]);
    await prisma.suggestion.updateMany({
      where: { findingId: fixed.id },
      data: { state: "accepted", resolutionCommitSha: "abc1234def5678", resolvedAt: new Date() },
    });
    await reviewed(0, 12, [finding("SQL built from input")]);
    // The same issue again on PR 12's next push counts once.
    await reviewed(0, 12, [finding("SQL built from input")]);
    // Another organization's identical finding is never returned (NFR-13).
    await reviewed(1, 11, [finding("SQL injection")]);

    const { reviewId } = await createReview(0, 13);
    const hits = await vectors.querySimilar(finding("SQL injection"), { organizationId: orgs[0]!, reviewId, limit: 3 });

    expect(hits.map((h) => [h.pullRequestNumber, h.title, h.repositoryFullName])).toEqual([
      [11, "SQL injection", "vec-org/repo-0"],
      [12, "SQL built from input", "vec-org/repo-0"],
    ]);
    expect(hits[0]).toMatchObject({ similarityScore: 1, resolution: "Fixed in abc1234", reviewId: expect.any(String) });
    expect(hits[1]?.similarityScore).toBeCloseTo(1 / Math.sqrt(1.09), 4);
    expect(hits[1]?.resolution).toBeUndefined();
  });

  it("skips the current pull request's earlier reviews", async () => {
    await reviewed(0, 21, [finding("SQL injection")]);
    const { reviewId } = await createReview(0, 21);

    const hits = await vectors.querySimilar(finding("SQL injection"), { organizationId: orgs[0]!, reviewId, limit: 10 });

    expect(hits.some((h) => h.pullRequestNumber === 21)).toBe(false);
  });

  it("stores the lookup's vector and its matches without embedding twice", async () => {
    const pastId = (await prisma.finding.findFirstOrThrow({ where: { title: "SQL injection", review: { organizationId: orgs[1] } } })).id;
    const current = finding("SQL injection");
    const { reviewId, agentRunId } = await createReview(1, 30);
    const before = embedder.calls;

    const similarPastIssues = await vectors.querySimilar(current, { organizationId: orgs[1]!, reviewId, limit: 3 });
    expect(similarPastIssues.map((h) => h.findingId)).toEqual([pastId]);

    await addFindings(reviewId, agentRunId, [current]);
    await vectors.index({ ...current, similarPastIssues }, orgs[1]!);

    expect(embedder.calls - before).toBe(1);
    const stored = await prisma.$queryRaw<{ model: string; dims: number }[]>`
      SELECT embedding_model AS model, vector_dims(embedding) AS dims FROM finding_embeddings WHERE finding_id = ${current.id}::uuid`;
    expect(stored).toEqual([{ model: "test-embedding", dims: 768 }]);
    const links = await prisma.findingSimilarity.findMany({ where: { findingId: current.id } });
    expect(links.map((l) => [l.similarFindingId, l.similarityScore.toNumber()])).toEqual([[pastId, 1]]);
  });
});
