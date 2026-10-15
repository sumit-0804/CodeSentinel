import { analyzePerFile, mergeRuleAndLlmFindings, type ReviewAgent } from "@code-sentinel/agent-kit";

import { issueKey } from "./cwe-families.js";
import { runSecurityLlmPass } from "./llm-pass.js";
import { capabilityRules } from "./rules.js";
import { scanFile } from "./scan.js";
import { SECRET_RULES } from "./secrets.js";

/**
 * The Security Agent (FR-SEC-01..04): deterministic SAST and secret rules on the added lines of every
 * request, plus one LLM call over the whole changed files when the orchestrator reserved quota for
 * it. `unknown` files (config, `.env`) are accepted so secrets in them are caught; code rules only
 * apply to their own languages. An LLM finding on the same issue as a rule (same CWE family, a few
 * lines apart) is dropped, and its fix moves to the rule finding.
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
    const llm = reached.length ? await runSecurityLlmPass(reached, context) : { findings: [] };
    return {
      findings: mergeRuleAndLlmFindings(rules.results, llm.findings, issueKey),
      skipped: rules.skipped,
      ...(llm.llm ? { llm: llm.llm } : {}),
    };
  },
};
