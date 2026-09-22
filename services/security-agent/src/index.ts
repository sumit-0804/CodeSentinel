/** @code-sentinel/security-agent: SAST rules, secret detection and an LLM pass (FR-SEC-01..04). */

export { securityAgent } from "./agent.js";
export { buildPrompt, runLlmPass, type LlmPassResult } from "./llm-pass.js";
export { CODE_RULES, type CodeRule } from "./rules.js";
export { scanFile, type SecurityFinding } from "./scan.js";
export { findSecrets, maskSecrets, maskValue, SECRET_RULES, type SecretMatch } from "./secrets.js";
