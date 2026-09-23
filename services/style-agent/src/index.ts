/** @code-sentinel/style-agent: linters and formatters in a Docker sandbox, no LLM (FR-STY-01..04). */

export { createStyleAgent } from "./agent.js";
export { fragmentFindings, type StyleFinding } from "./findings.js";
export { buildFragments, originalText, type Fragment } from "./fragments.js";
export {
  DEFAULT_SANDBOX_IMAGE,
  DockerSandbox,
  type DockerSandboxOptions,
  type Sandbox,
  type SandboxFile,
  type SandboxFileResult,
  type SandboxResult,
} from "./sandbox.js";
