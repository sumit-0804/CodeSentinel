import { runLlmPass, type LlmPassOptions, type ReviewAgent } from "@code-sentinel/agent-kit";

const SYSTEM_PROMPT = `You are the Documentation Agent of an automated code review.
Read each file as a whole. Look only at PUBLIC functions, methods and classes whose signature or body has added
lines: exported ones in JavaScript and TypeScript, and in Python those whose name does not start with "_".
Report one finding for each such symbol that has no docstring or JSDoc ("documentation/missing-docstring"), or
whose docstring does not describe every parameter and the return value ("documentation/incomplete-docstring").
Point lineStart and lineEnd at the symbol's signature line(s).
Write the documentation from what the code actually does, in the style the file already uses (Google or reST
docstrings in Python, JSDoc with @param and @returns in JavaScript and TypeScript).
suggestedCode replaces the signature line(s) with the documented version: for JavaScript and TypeScript the JSDoc
block followed by the unchanged signature; for Python the unchanged signature followed by the docstring, indented
one level deeper. If the signature lines were not added by this pull request, use "" and put the suggested text in
the description instead.
Use severity "info" and "" as the CWE id. Do not report anything else: other agents review bugs, security,
performance and style.`;

const RULES = new Set(["documentation/missing-docstring", "documentation/incomplete-docstring"]);

export const DOCUMENTATION_LLM_PASS: LlmPassOptions = {
  systemPrompt: SYSTEM_PROMPT,
  task: "Review these changes for missing or incomplete documentation of public code.",
  schemaName: "documentation_findings",
  rulePrefix: "documentation/",
  agentName: "Documentation",
  allowCwe: false,
  required: true,
};

/**
 * The Documentation Agent (FR-DOC-01/02): one LLM call per request over the whole changed files.
 * Its findings are always `info`, so they never block a merge on severity, and only its two rules
 * are kept, so an off-topic answer from the model does not leak into the report.
 */
export const documentationAgent: ReviewAgent = {
  kind: "documentation",
  version: "1.0.0",
  languages: ["python", "javascript", "typescript"],
  usesLlm: true,
  maxDiffBytes: 5_000_000,
  // The orchestrator already sizes each batch for one LLM call.
  maxFileTokens: 50_000,

  async analyze(files, context) {
    const { findings, llm } = await runLlmPass(files, context, DOCUMENTATION_LLM_PASS);
    const kept = findings.filter((finding) => RULES.has(finding.ruleId));
    if (kept.length < findings.length) context.logger.info("off-topic documentation findings dropped", { dropped: findings.length - kept.length });
    return { findings: kept.map((finding) => ({ ...finding, severity: "info" as const })), ...(llm ? { llm } : {}) };
  },
};
