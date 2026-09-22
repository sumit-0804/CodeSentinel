import { analyzePerFile, type ReviewAgent } from "@code-sentinel/agent-kit";

import { runLlmPass } from "./llm-pass.js";
import { capabilityRules } from "./rules.js";
import { scanFile, type SecurityFinding } from "./scan.js";
import { SECRET_RULES } from "./secrets.js";

/** Same key as the rule and the location, so a rule and the LLM never report one issue twice. */
const key = (finding: SecurityFinding) => `${finding.location.filePath}:${finding.location.lineStart}:${finding.cweId ?? finding.ruleId}`;

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

    const seen = new Set(rules.results.map(key));
    const extra = llm.findings.filter((finding) => !seen.has(key(finding)));
    return {
      findings: [...rules.results, ...extra],
      skipped: rules.skipped,
      ...(llm.llm ? { llm: llm.llm } : {}),
    };
  },
};
