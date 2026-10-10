/**
 * CWE ids that describe the same weakness. An LLM may name a sibling of the rule's CWE (seen live:
 * CWE-321 for a hardcoded AWS key the rule reports as CWE-798), which must still count as one issue.
 */
const FAMILIES: Record<string, readonly string[]> = {
  "hardcoded-credentials": ["CWE-798", "CWE-259", "CWE-321", "CWE-522", "CWE-547"],
  "sql-injection": ["CWE-89", "CWE-564", "CWE-943"],
  "command-injection": ["CWE-78", "CWE-77", "CWE-88"],
  "code-injection": ["CWE-94", "CWE-95"],
  "cross-site-scripting": ["CWE-79", "CWE-80"],
  "path-traversal": ["CWE-22", "CWE-23", "CWE-35", "CWE-73"],
  "unsafe-deserialization": ["CWE-502"],
  "open-redirect": ["CWE-601"],
};

const FAMILY_OF = new Map(Object.entries(FAMILIES).flatMap(([family, ids]) => ids.map((id) => [id, family] as const)));

/** The key two findings must share to be the same issue: the CWE family, else the CWE, else the rule id. */
export function issueKey(finding: { cweId?: string; ruleId: string }): string {
  if (!finding.cweId) return finding.ruleId;
  return FAMILY_OF.get(finding.cweId) ?? finding.cweId;
}
