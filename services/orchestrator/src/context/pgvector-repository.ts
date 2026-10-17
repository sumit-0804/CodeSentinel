import type { Finding, SimilarPastIssue } from "@code-sentinel/contracts";
import { Prisma, type PrismaClient } from "@code-sentinel/db";

import type { SimilarityScope, StoredFinding, VectorRepository } from "./vector-repository.js";

/** `GeminiEmbedder` from `@code-sentinel/llm`, or a fake in tests. */
export interface Embedder {
  embedMany(texts: readonly string[], options?: { signal?: AbortSignal }): Promise<number[][]>;
}

export interface PgVectorRepositoryOptions {
  embedder: Embedder;
  /** Stored with each vector, so a model change can be re-indexed later. */
  embeddingModel: string;
  /** Cosine similarity a past finding needs to count as "seen before". */
  minSimilarity?: number;
}

export const DEFAULT_MIN_SIMILARITY = 0.8;
// Vectors embedded during the lookup wait here until the finding's row exists and `index` stores them.
const MAX_CACHED_VECTORS = 500;

interface SimilarRow {
  finding_id: string;
  title: string;
  score: number;
  review_id: string;
  pr_number: number | null;
  full_name: string;
  created_at: Date;
  state: string | null;
  resolution_commit_sha: string | null;
  rejection_reason: string | null;
}

/** What gets embedded: the issue, not the code, so no source leaves the organization's own rows. */
export function embeddingText(finding: Finding): string {
  const extension = finding.location.filePath.match(/\.[^./\\]+$/)?.[0] ?? "";
  return [
    `${finding.agent} ${finding.ruleId}${finding.cweId ? ` ${finding.cweId}` : ""}${extension ? ` ${extension}` : ""}`,
    finding.title,
    finding.description,
  ].join("\n");
}

export function resolutionOf(row: Pick<SimilarRow, "state" | "resolution_commit_sha" | "rejection_reason">): string | undefined {
  if (row.state === "accepted") return row.resolution_commit_sha ? `Fixed in ${row.resolution_commit_sha.slice(0, 7)}` : "Fixed";
  if (row.state === "rejected") return row.rejection_reason ? `Dismissed (${row.rejection_reason.replaceAll("_", " ")})` : "Dismissed";
  if (row.state === "proposed") return "Open";
  return undefined;
}

/**
 * `VectorRepository` on pgvector. The search is exact over the organization's rows and keeps the
 * closest finding per pull request, so one issue re-reviewed on every push counts once.
 */
export class PgVectorRepository implements VectorRepository {
  private readonly embedder: Embedder;
  private readonly embeddingModel: string;
  private readonly minSimilarity: number;
  private readonly vectors = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaClient,
    options: PgVectorRepositoryOptions,
  ) {
    this.embedder = options.embedder;
    this.embeddingModel = options.embeddingModel;
    this.minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  }

  async querySimilar(finding: StoredFinding, scope: SimilarityScope): Promise<SimilarPastIssue[]> {
    const vector = toLiteral(await this.vectorOf(finding, scope.signal));
    const rows = await this.prisma.$queryRaw<SimilarRow[]>`
      WITH current_review AS (
        SELECT repository_id, pr_number FROM reviews WHERE id = ${scope.reviewId}::uuid
      ), nearest AS (
        SELECT DISTINCT ON (r.repository_id, r.pr_number)
               f.id AS finding_id, f.title, 1 - (e.embedding <=> ${vector}::vector) AS score,
               r.id AS review_id, r.pr_number, repo.full_name, r.created_at,
               s.state::text AS state, s.resolution_commit_sha, s.rejection_reason::text AS rejection_reason
          FROM finding_embeddings e
          JOIN findings f ON f.id = e.finding_id
          JOIN reviews r ON r.id = f.review_id
          JOIN repositories repo ON repo.id = r.repository_id
          LEFT JOIN current_review cur ON TRUE
          LEFT JOIN LATERAL (
            SELECT state, resolution_commit_sha, rejection_reason FROM suggestions
             WHERE finding_id = f.id ORDER BY created_at DESC LIMIT 1
          ) s ON TRUE
         WHERE e.organization_id = ${scope.organizationId}::uuid
           AND f.review_id <> ${scope.reviewId}::uuid
           AND (cur.pr_number IS NULL OR r.repository_id <> cur.repository_id OR r.pr_number IS DISTINCT FROM cur.pr_number)
           AND 1 - (e.embedding <=> ${vector}::vector) >= ${this.minSimilarity}
         ORDER BY r.repository_id, r.pr_number, e.embedding <=> ${vector}::vector, r.created_at DESC
      )
      SELECT * FROM nearest ORDER BY score DESC, created_at DESC LIMIT ${scope.limit}`;

    return rows.map((row) => {
      const resolution = resolutionOf(row);
      return {
        findingId: row.finding_id,
        similarityScore: Math.min(1, Math.max(0, Number(row.score))),
        title: row.title,
        repositoryFullName: row.full_name,
        reviewId: row.review_id,
        ...(row.pr_number !== null ? { pullRequestNumber: row.pr_number } : {}),
        ...(resolution ? { resolution } : {}),
        occurredAt: row.created_at.toISOString(),
      };
    });
  }

  async index(finding: StoredFinding, organizationId: string): Promise<void> {
    const vector = toLiteral(await this.vectorOf(finding));
    await this.prisma.$executeRaw`
      INSERT INTO finding_embeddings (finding_id, organization_id, embedding, embedding_model)
      VALUES (${finding.id}::uuid, ${organizationId}::uuid, ${vector}::vector, ${this.embeddingModel})
      ON CONFLICT (finding_id) DO NOTHING`;
    this.vectors.delete(finding.id);

    const similar = (finding.similarPastIssues ?? []).filter((issue) => issue.findingId !== finding.id);
    if (similar.length === 0) return;
    const values = similar.map(
      (issue) => Prisma.sql`(${finding.id}::uuid, ${issue.findingId}::uuid, ${issue.similarityScore.toFixed(4)}::numeric)`,
    );
    // The join skips a past finding deleted since the lookup.
    await this.prisma.$executeRaw`
      INSERT INTO finding_similarities (finding_id, similar_finding_id, similarity_score)
      SELECT v.finding_id, v.similar_finding_id, v.score
        FROM (VALUES ${Prisma.join(values)}) AS v(finding_id, similar_finding_id, score)
        JOIN findings f ON f.id = v.similar_finding_id
      ON CONFLICT DO NOTHING`;
  }

  private async vectorOf(finding: StoredFinding, signal?: AbortSignal): Promise<number[]> {
    const cached = this.vectors.get(finding.id);
    if (cached) return cached;
    const [vector] = await this.embedder.embedMany([embeddingText(finding)], signal ? { signal } : {});
    if (!vector) throw new Error(`No embedding returned for finding ${finding.id}`);
    if (this.vectors.size >= MAX_CACHED_VECTORS) {
      const oldest = this.vectors.keys().next().value;
      if (oldest !== undefined) this.vectors.delete(oldest);
    }
    this.vectors.set(finding.id, vector);
    return vector;
  }
}

function toLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}
