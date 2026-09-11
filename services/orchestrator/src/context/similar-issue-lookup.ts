import type { Finding } from "../types.js";
import type { VectorRepository } from "./vector-repository.js";

/**
 * The context step of the review graph (`ContextNode` / `SimilarIssueLookup` in the class
 * diagram): for each finding, attach up to `limit` semantically similar past issues so the
 * report can show whether this is a recurring problem (FR-ORC-05, US-13).
 *
 * A lookup failure must never fail the review — findings are returned unchanged.
 */
export class SimilarIssueLookup {
  constructor(
    private readonly vectors: VectorRepository,
    private readonly limit = 3,
  ) {}

  async attach(findings: Finding[], organizationId: string): Promise<Finding[]> {
    return Promise.all(
      findings.map(async (finding) => {
        try {
          const similarPastIssues = await this.vectors.querySimilar(
            finding,
            organizationId,
            this.limit,
          );
          return { ...finding, similarPastIssues };
        } catch {
          return finding;
        }
      }),
    );
  }

  async index(findings: Finding[], organizationId: string): Promise<void> {
    for (const finding of findings) {
      try {
        await this.vectors.index(finding, organizationId);
      } catch {
        // Best effort: a failed index write should not affect the current review.
      }
    }
  }
}
