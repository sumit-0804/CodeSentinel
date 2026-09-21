import type {
  AgentKind,
  AgentLlmUsage,
  AgentReviewOptions,
  CapabilityRule,
  ChangedFile,
  Finding,
  HealthStatus,
  Language,
  SkippedFile,
} from "@code-sentinel/contracts";
import type { LlmClient, LlmProviderName } from "@code-sentinel/llm";
import type { Logger } from "@code-sentinel/service-kit";

/** Everything `analyze` may use for one review request. */
export interface AgentContext {
  reviewId: string;
  requestId: string;
  logger: Logger;
  /** Fires at the deadline or when the orchestrator hangs up; stop starting new work. */
  signal: AbortSignal;
  /** Epoch ms from `options.deadlineMs`; `Infinity` when the caller set none. */
  deadlineAt: number;
  /** Present only when the orchestrator reserved quota (`options.llmProvider`) and a key is set. */
  llm?: { client: LlmClient; provider: LlmProviderName };
  /** The request's `options`, including agent-specific switches. */
  options: AgentReviewOptions;
}

export interface AnalysisResult {
  /** `agent` is filled in by the kit; agents may leave it to the kit. */
  findings: Array<Omit<Finding, "agent"> & { agent?: Finding["agent"] }>;
  /** Files the agent chose not to analyze, e.g. `over_budget` past the deadline. */
  skipped?: SkippedFile[];
  /** Token usage of the LLM call, when one was made. */
  llm?: AgentLlmUsage;
}

/**
 * `ReviewAgent` / `BaseAgentService` from `class_agent.mmd`. An agent describes itself and
 * supplies `analyze`; the kit owns the HTTP contract, validation and the per-file skips.
 */
export interface ReviewAgent {
  kind: AgentKind;
  version: string;
  languages: Language[];
  usesLlm: boolean;
  producesDeterministicFixes?: boolean;
  /** Whole request body cap; larger requests get 413. */
  maxDiffBytes: number;
  /** A file over this many estimated tokens is `too_large`. */
  maxFileTokens: number;
  rules?: CapabilityRule[];
  /** Receives only files in a supported language and under `maxFileTokens`. */
  analyze(files: ChangedFile[], context: AgentContext): Promise<AnalysisResult>;
  /** Dependency checks for `/healthz`, e.g. `{ sandbox: "ok" }`. */
  health?(): Promise<Record<string, HealthStatus>>;
}
