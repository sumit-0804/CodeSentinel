/**
 * @code-sentinel/agent-kit: the shared base of the five agent services (`class_agent.mmd`). An
 * agent supplies `analyze`; the kit owns `agent.yaml`, validation, per-file skips and the deadline.
 */

export type { AgentContext, AnalysisResult, ReviewAgent } from "./agent.js";
export { createAgentService, type AgentServiceDeps } from "./app.js";
export { AgentConfigError, loadAgentEnv, type AgentEnv } from "./config.js";
export { hunkText, parsePatch, type Hunk, type NewLine, type ParsedPatch } from "./patch.js";
export { analyzePerFile, runReview, type RunReviewOptions } from "./review.js";
export { startAgentService, type StartOptions } from "./server.js";
