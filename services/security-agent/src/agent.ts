import { analyzePerFile, type ReviewAgent } from "@code-sentinel/agent-kit";

import { runLlmPass } from "./llm-pass.js";
import { capabilityRules } from "./rules.js";
import { scanFile, type SecurityFinding } from "./scan.js";
import { SECRET_RULES } from "./secrets.js";

/** An LLM's line numbers can drift a little (seen live: off by 2), so nearby counts as the same issue. */
const DUPLICATE_LINES = 3;

/** True when a rule already reported this issue: same file, same CWE (or rule id), within a few lines. */
function isDuplicate(finding: SecurityFinding, rules: SecurityFinding[]): boolean {
  return rules.some(
    (rule) =>
      rule.location.filePath === finding.location.filePath &&
      (rule.cweId ?? rule.ruleId) === (finding.cweId ?? finding.ruleId) &&
      Math.abs(rule.location.lineStart - finding.location.lineStart) <= DUPLICATE_LINES,
  );
}

/**
 * An LLM duplicate of a rule finding is dropped, but its fix is worth keeping: the rule finding takes
 * it, and the fix's line range, when that range covers the rule's line (so the fix is for this issue).
 */
function adoptSuggestion(duplicate: SecurityFinding, rules: SecurityFinding[]): void {
  if (!duplicate.suggestion) return;
  const { filePath, lineStart, lineEnd } = duplicate.location;
  const rule = rules.find(
    (candidate) =>
      !candidate.suggestion &&
      candidate.location.filePath === filePath &&
      candidate.location.lineStart >= lineStart &&
      candidate.location.lineStart <= lineEnd &&
      (candidate.cweId ?? candidate.ruleId) === (duplicate.cweId ?? duplicate.ruleId),
  );
  if (!rule) return;
  rule.suggestion = duplicate.suggestion;
  rule.location = { ...duplicate.location };
}

/**
 * The Security Agent (FR-SEC-01..04): deterministic SAST and secret rules on every request, plus
 * one LLM call when the orchestrator reserved quota for it. `unknown` files (config, `.env`) are
 * accepted so secrets in them are caught; code rules only apply to their own languages.
 */
export const securityAgent: ReviewAgent = {
  kind: "security",
  version: "1.0.0",
  languages: ["python", "javascript", "typescript", "unknown"],
  usesLlm: true,
  maxDiffBytes: 5_000_000,
  // The rule pass is cheap; the orchestrator already caps LLM batches at LLM_MAX_FILE_TOKENS.
  maxFileTokens: 50_000,
  rules: capabilityRules(SECRET_RULES),

  async analyze(files, context) {
    const rules = await analyzePerFile(files, context, scanFile);
    const reached = files.filter((file) => !rules.skipped.some((skip) => skip.path === file.path));
    const llm = reached.length ? await runLlmPass(reached, context) : { findings: [] };

    const findings = rules.results.map((finding) => ({ ...finding }));
    const extra: SecurityFinding[] = [];
    for (const finding of llm.findings) {
      if (!isDuplicate(finding, findings)) extra.push(finding);
      else adoptSuggestion(finding, findings);
    }
    return {
      findings: [...findings, ...extra],
      skipped: rules.skipped,
      ...(llm.llm ? { llm: llm.llm } : {}),
    };
  },
};
