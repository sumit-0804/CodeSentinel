import { runLlmPass, type LlmPassOptions, type ReviewAgent } from "@code-sentinel/agent-kit";

const SYSTEM_PROMPT = `You are the Logic Agent of an automated code review.
Read each file as a whole to understand what the changed code is meant to do, then report bugs that the added
lines introduce or expose:
- null, None or undefined values used without a check the surrounding code guarantees
- off-by-one errors and wrong loop or slice bounds
- exceptions or promise rejections that are not handled, and errors that are caught and silently dropped
- conditions that are inverted, always true or always false, and branches that can never run
- a function, defined in this file or in the other changes, used against what it now returns or expects
Explain the bug and the input that triggers it in the description. Give a CWE id when one fits (for example
CWE-476 null dereference, CWE-193 off-by-one, CWE-754 unchecked condition, CWE-755 unhandled exception,
CWE-480 wrong operator). Severity is critical when the bug breaks normal use, warning when it breaks an edge case.
Do not report security vulnerabilities, style, performance or documentation: other agents do.`;

export const LOGIC_LLM_PASS: LlmPassOptions = {
  systemPrompt: SYSTEM_PROMPT,
  task: "Review these changes for logic bugs.",
  schemaName: "logic_findings",
  rulePrefix: "logic/",
  agentName: "Logic",
  allowCwe: true,
  required: true,
};

/**
 * The Logic Agent (FR-LOG-01/02): one LLM call per request over the whole changed files, through the
 * shared LLM layer with its Groq-to-Gemini fallback. It has no rules, so a failed call fails the
 * run instead of reporting the code as clean.
 */
export const logicAgent: ReviewAgent = {
  kind: "logic",
  version: "1.0.0",
  languages: ["python", "javascript", "typescript"],
  usesLlm: true,
  maxDiffBytes: 5_000_000,
  // The orchestrator already sizes each batch for one LLM call.
  maxFileTokens: 50_000,

  async analyze(files, context) {
    const { findings, llm } = await runLlmPass(files, context, LOGIC_LLM_PASS);
    return { findings, ...(llm ? { llm } : {}) };
  },
};
