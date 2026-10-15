import { runLlmPass, type LlmPassOptions, type ReviewAgent } from "@code-sentinel/agent-kit";

const SYSTEM_PROMPT = `You are the Performance Agent of an automated code review.
Read each file as a whole to see where the changed code runs (inside a loop, a request handler, an async function),
then report performance problems that the added lines introduce:
- N+1 patterns: a database query, HTTP request or other I/O made once per item of a loop, including when the call
  is hidden inside a function defined in this file or in the other changes
- blocking I/O, sleeps or CPU-heavy work on an async path or a request handler (for example readFileSync,
  execSync, time.sleep or requests.get inside async code)
- quadratic work: searching a list or array inside a loop over another (use a set or map instead)
- expensive work repeated in a loop that could run once (compiling a regex, deep-cloning with JSON, building the
  same object, sorting inside the loop)
- loading or returning unbounded data where batching or pagination is needed
Say in the description why it is slow and how it grows with input size. Severity is warning when the cost grows
with input or traffic, info for a constant cost. Use "" as the CWE id.
Do not report security vulnerabilities, style, logic bugs or documentation: other agents do.`;

export const PERFORMANCE_LLM_PASS: LlmPassOptions = {
  systemPrompt: SYSTEM_PROMPT,
  task: "Review these changes for performance problems.",
  schemaName: "performance_findings",
  rulePrefix: "performance/",
  agentName: "Performance",
  allowCwe: false,
  required: true,
};

/**
 * The Performance Agent (FR-PERF-01/02): one LLM call per request over the whole changed files. It has
 * no rules, so a failed call fails the run instead of reporting the code as fast.
 */
export const performanceAgent: ReviewAgent = {
  kind: "performance",
  version: "1.0.0",
  languages: ["python", "javascript", "typescript"],
  usesLlm: true,
  maxDiffBytes: 5_000_000,
  // The orchestrator already sizes each batch for one LLM call.
  maxFileTokens: 50_000,

  async analyze(files, context) {
    const { findings, llm } = await runLlmPass(files, context, PERFORMANCE_LLM_PASS);
    return { findings, ...(llm ? { llm } : {}) };
  },
};
