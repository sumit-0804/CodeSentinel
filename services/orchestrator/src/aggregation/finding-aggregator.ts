import { createHash } from "node:crypto";

import type { Finding } from "@code-sentinel/contracts";

/**
 * Collapses findings that describe the same issue reported by more than one agent (FR-ORC-03).
 *
 * The dedupe key is `hash(filePath, lineStart, lineEnd, ruleId)` per the orchestrator class
 * diagram. When two findings share a key, the higher-confidence one is kept and its
 * `duplicateCount` is incremented.
 */
export class FindingAggregator {
  dedupe(findings: Finding[]): Finding[] {
    const byKey = new Map<string, Finding>();

    for (const finding of findings) {
      const key = this.dedupeKey(finding);
      const existing = byKey.get(key);

      if (!existing) {
        byKey.set(key, { ...finding, duplicateCount: finding.duplicateCount ?? 1 });
        continue;
      }

      const merged = existing.confidence >= finding.confidence ? existing : finding;
      byKey.set(key, {
        ...merged,
        duplicateCount:
          (existing.duplicateCount ?? 1) + (finding.duplicateCount ?? 1),
      });
    }

    return [...byKey.values()];
  }

  private dedupeKey(finding: Finding): string {
    const { filePath, lineStart, lineEnd } = finding.location;
    return createHash("sha1")
      .update(`${filePath}:${lineStart}:${lineEnd}:${finding.ruleId}`)
      .digest("hex");
  }
}
