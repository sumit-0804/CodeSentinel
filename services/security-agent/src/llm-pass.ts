import type { ChangedFile } from "@code-sentinel/contracts";
import { buildLlmPrompt, runLlmPass, type AgentContext, type LlmPassOptions, type LlmPassResult } from "@code-sentinel/agent-kit";

import { maskSecrets } from "./secrets.js";

const SYSTEM_PROMPT = `You are the Security Agent of an automated code review.
Report security vulnerabilities introduced by the added lines: injection (SQL, command, code, LDAP, template),
XSS, insecure deserialization, path traversal, SSRF, broken authentication or authorization, weak cryptography,
insecure randomness for secrets, sensitive data exposure, and unsafe file or network handling. Use the rest of the
file to judge whether input is really untrusted and whether it is already validated or escaped.
Do not report style, performance, documentation or general bugs.
Secrets in the input are already masked as "****"; do not report masked values. For a leaked key there is no
safe local fix (it must be revoked), so its suggestedCode is "".
lineStart is the line with the vulnerable code itself (for example the query call, not the connection set up before it).`;

const TASK = "Review these changes for security vulnerabilities.";

const OPTIONS: LlmPassOptions = {
  systemPrompt: SYSTEM_PROMPT,
  task: TASK,
  schemaName: "security_findings",
  rulePrefix: "security/",
  agentName: "Security",
  allowCwe: true,
  mask: maskSecrets,
};

/** The prompt the model sees for `files`, secrets masked. */
export function buildPrompt(files: ChangedFile[]): string {
  return buildLlmPrompt(TASK, files, [], maskSecrets);
}

/**
 * One LLM call for the whole request on the provider the orchestrator reserved. A failure never
 * fails the review: the rule findings still stand, and the error is logged.
 */
export function runSecurityLlmPass(files: ChangedFile[], context: AgentContext): Promise<LlmPassResult> {
  return runLlmPass(files, context, OPTIONS);
}
