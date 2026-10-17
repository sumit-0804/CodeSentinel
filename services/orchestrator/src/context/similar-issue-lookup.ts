import type { Finding } from "@code-sentinel/contracts";
import type { StoredFinding, VectorRepository } from "./vector-repository.js";

export interface SimilarIssueLookupOptions {
  /** Past issues attached to each finding. */
  limit?: number;
  /** Findings looked up per review, highest ranked first; each costs one embedding request. */
  maxFindings?: number;
  /** The whole lookup's time limit; findings not done by then go out without past issues. */
  timeoutMs?: number;
}

export interface LookupScope {
  organizationId: string;
  reviewId: string;
  confidenceThreshold: number;
}

export const DEFAULT_CONTEXT_MAX_FINDINGS = 20;
export const DEFAULT_CONTEXT_TIMEOUT_MS = 5000;

const hasId = (finding: Finding): finding is StoredFinding => finding.id !== undefined;

/**
 * The context step of the review graph (`ContextNode` / `SimilarIssueLookup` in the class
 * diagram): for each postable finding, attach up to `limit` semantically similar past issues so
 * the report can show whether this is a recurring problem (FR-ORC-05, US-13).
 *
 * A lookup failure must never fail the review — findings are returned unchanged.
 */
export class SimilarIssueLookup {
  private readonly limit: number;
  private readonly maxFindings: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly vectors: VectorRepository,
    options: SimilarIssueLookupOptions = {},
  ) {
    this.limit = options.limit ?? 3;
    this.maxFindings = options.maxFindings ?? DEFAULT_CONTEXT_MAX_FINDINGS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_CONTEXT_TIMEOUT_MS;
  }

  /** The findings worth a lookup: above the threshold, in report order (already ranked), capped. */
  candidates(findings: readonly Finding[], confidenceThreshold: number): StoredFinding[] {
    return findings.filter(hasId).filter((f) => f.confidence >= confidenceThreshold).slice(0, this.maxFindings);
  }

  async attach(findings: Finding[], scope: LookupScope): Promise<Finding[]> {
    const wanted = new Set(this.candidates(findings, scope.confidenceThreshold));
    const signal = AbortSignal.timeout(this.timeoutMs);
    return Promise.all(
      findings.map(async (finding) => {
        if (!wanted.has(finding as StoredFinding)) return finding;
        try {
          const similarPastIssues = await untilAborted(
            this.vectors.querySimilar(finding as StoredFinding, {
              organizationId: scope.organizationId,
              reviewId: scope.reviewId,
              limit: this.limit,
              signal,
            }),
            signal,
          );
          return similarPastIssues.length > 0 ? { ...finding, similarPastIssues } : finding;
        } catch {
          return finding;
        }
      }),
    );
  }

  /** Called once the findings' rows exist; returns how many could not be indexed. */
  async index(findings: readonly Finding[], scope: Omit<LookupScope, "reviewId">): Promise<number> {
    let failed = 0;
    for (const finding of this.candidates(findings, scope.confidenceThreshold)) {
      try {
        await this.vectors.index(finding, scope.organizationId);
      } catch {
        failed += 1;
      }
    }
    return failed;
  }
}

/** A database query ignores the signal, so the deadline is enforced here too. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
