import type { Finding, SimilarPastIssue } from "@code-sentinel/contracts";

/** Where a lookup may search: one organization (NFR-13), never the current review's own pull request. */
export interface SimilarityScope {
  organizationId: string;
  reviewId: string;
  limit: number;
  signal?: AbortSignal;
}

/** A finding the orchestrator has given an id; `findings` rows use the same id. */
export type StoredFinding = Finding & { id: string };

/**
 * Storage-facing side of context-aware review (FR-VDB-01/02). Vectors live in pgvector
 * (`finding_embeddings`) in the same database as the findings (see `docs/design/schema/schema.sql`).
 */
export interface VectorRepository {
  /** Nearest previously flagged issues for this finding, above the similarity threshold. */
  querySimilar(finding: StoredFinding, scope: SimilarityScope): Promise<SimilarPastIssue[]>;

  /** Stores the finding's vector, and its `similarPastIssues` as `finding_similarities`, once its row exists. */
  index(finding: StoredFinding, organizationId: string): Promise<void>;
}
