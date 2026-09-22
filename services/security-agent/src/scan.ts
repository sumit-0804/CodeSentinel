import type { ChangedFile } from "@code-sentinel/contracts";
import { parsePatch, type AnalysisResult } from "@code-sentinel/agent-kit";

import { CODE_RULES, isCommentLine } from "./rules.js";
import { findSecrets, maskSecrets, maskValue } from "./secrets.js";

export type SecurityFinding = AnalysisResult["findings"][number];

/**
 * The deterministic pass: every code rule for the file's language and every secret pattern,
 * against added lines only (FR-SEC-01, FR-SEC-02). One finding per rule per line.
 */
export function scanFile(file: ChangedFile): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const { line, text } of parsePatch(file.patch).addedLines) {
    const location = { filePath: file.path, lineStart: line, lineEnd: line };

    for (const secret of findSecrets(text)) {
      const shown = maskValue(text.slice(secret.start, secret.end));
      findings.push({
        ruleId: secret.ruleId,
        title: `${secret.title} committed in code`,
        description: `A ${secret.title.toLowerCase()} (${shown}) is hardcoded. Revoke it, then load it from the environment or a secret manager.`,
        location,
        severity: "critical",
        confidence: secret.confidence,
        cweId: "CWE-798",
      });
    }

    if (isCommentLine(text, file.language)) continue;
    const seen = new Set<string>();
    for (const rule of CODE_RULES) {
      if (!rule.languages.includes(file.language) || seen.has(rule.ruleId) || !rule.pattern.test(text)) continue;
      seen.add(rule.ruleId);
      findings.push({
        ruleId: rule.ruleId,
        title: rule.title,
        description: `${rule.description} Line: ${maskSecrets(text.trim()).slice(0, 160)}`,
        location,
        severity: rule.severity,
        confidence: rule.confidence,
        cweId: rule.cweId,
      });
    }
  }
  return findings;
}
