import { createHash } from "node:crypto";

import { issueKey, type AlsoReported, type Finding } from "@code-sentinel/contracts";

import { severityRank } from "./severity-ranker.js";

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
      const key = dedupeKey(finding);
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

  /**
   * Clubs findings from different agents on the same issue: same file, overlapping lines and the
   * same `issueKey` (CWE family, else CWE, else rule). One finding stays, at the group's highest
   * severity; the others become its `alsoReportedBy`.
   */
  club(findings: Finding[]): Finding[] {
    const groups: Finding[][] = [];
    for (const finding of findings) {
      const key = issueKey(finding);
      const group = groups.find(
        (members) =>
          issueKey(members[0]!) === key &&
          members.every((member) => member.agent !== finding.agent) &&
          members.some((member) => overlaps(member, finding)),
      );
      if (group) group.push(finding);
      else groups.push([finding]);
    }
    return groups.map((members) => (members.length === 1 ? members[0]! : mergeGroup(members)));
  }
}

/** `hash(filePath, lineStart, lineEnd, ruleId)`; also stored as `findings.dedupe_key`. */
export function dedupeKey(finding: Finding): string {
  const { filePath, lineStart, lineEnd } = finding.location;
  return createHash("sha1")
    .update(`${filePath}:${lineStart}:${lineEnd}:${finding.ruleId}`)
    .digest("hex");
}

function overlaps(a: Finding, b: Finding): boolean {
  return (
    a.location.filePath === b.location.filePath &&
    a.location.lineStart <= b.location.lineEnd &&
    b.location.lineStart <= a.location.lineEnd
  );
}

/** The kept finding is one with a fix if any has one, then the most confident, so its location fits its fix. */
function mergeGroup(members: Finding[]): Finding {
  const [primary, ...others] = [...members].sort(
    (a, b) => Number(!!b.suggestion) - Number(!!a.suggestion) || b.confidence - a.confidence,
  ) as [Finding, ...Finding[]];
  const severity = members.reduce((worst, member) => (severityRank(member.severity) < severityRank(worst) ? member.severity : worst), primary.severity);
  const alsoReportedBy: AlsoReported[] = others.map(({ agent, ruleId, title, description, severity, confidence }) => ({
    agent,
    ruleId,
    title,
    description,
    severity,
    confidence,
  }));
  return {
    ...primary,
    severity,
    duplicateCount: members.reduce((sum, member) => sum + (member.duplicateCount ?? 1), 0),
    alsoReportedBy,
  };
}
