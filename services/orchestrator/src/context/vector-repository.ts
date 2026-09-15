import type { Finding, SimilarPastIssue } from "@code-sentinel/contracts";

/**
 * Storage-facing side of context-aware review (FR-VDB-01/02).
 *
 * Vectors live in ChromaDB; PostgreSQL keeps the `finding_embeddings` / `finding_similarities`
 * mapping so a finding can be traced both ways (see `docs/design/schema/schema.sql`).
 * Retrieval is always scoped to one organization — no cross-tenant sharing (NFR-13).
 */
export interface VectorRepository {
  /** Embed a finding and upsert it into the org's collection. */
  index(finding: Finding, organizationId: string): Promise<void>;

  /** Nearest previously-flagged issues for this finding, above the similarity threshold. */
  querySimilar(
    finding: Finding,
    organizationId: string,
    limit?: number,
  ): Promise<SimilarPastIssue[]>;
}

/**
 * ChromaDB-backed implementation. Not wired yet — the Chroma client, embedding model and
 * collection-per-org layout are the next step on the vector-DB work package (W13–W14).
 */
export class ChromaVectorRepository implements VectorRepository {
  async index(_finding: Finding, _organizationId: string): Promise<void> {
    throw new Error("ChromaVectorRepository.index is not implemented yet");
  }

  async querySimilar(
    _finding: Finding,
    _organizationId: string,
    _limit = 5,
  ): Promise<SimilarPastIssue[]> {
    throw new Error("ChromaVectorRepository.querySimilar is not implemented yet");
  }
}
