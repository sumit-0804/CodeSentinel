import { Annotation } from "@langchain/langgraph";

import type {
  AgentKind,
  AgentRunSummary,
  ChangedFile,
  CombinedReport,
  Finding,
  SkippedFile,
} from "@code-sentinel/contracts";
import type { AgentSkippedFiles } from "../aggregation/skipped-files.js";

const concat = <T>(left: T[], right: T[]): T[] => left.concat(right);

/**
 * `ReviewState` from the orchestrator class diagram: everything one review carries through the
 * graph. Inputs are set once by `toInitialState()`; `rawFindings`, `agentRuns` and
 * `agentSkippedFiles` accumulate across node updates; `report` is written by `aggregate` and
 * refined by `context` and `threshold`.
 */
export const ReviewStateAnnotation = Annotation.Root({
  reviewId: Annotation<string>,
  organizationId: Annotation<string>,
  /** Propagated to every agent as `X-Request-Id` (NFR-12). */
  requestId: Annotation<string | undefined>,
  files: Annotation<ChangedFile[]>,
  /** Files the gateway dropped before fan-out. */
  gatewaySkippedFiles: Annotation<SkippedFile[]>,
  enabledAgents: Annotation<AgentKind[]>,
  confidenceThreshold: Annotation<number>,
  agentTimeoutMs: Annotation<number>,
  includeSimilarPastIssues: Annotation<boolean>,

  rawFindings: Annotation<Finding[]>({ reducer: concat, default: () => [] }),
  agentRuns: Annotation<AgentRunSummary[]>({ reducer: concat, default: () => [] }),
  agentSkippedFiles: Annotation<AgentSkippedFiles[]>({ reducer: concat, default: () => [] }),

  report: Annotation<CombinedReport | undefined>,
});

export type ReviewState = typeof ReviewStateAnnotation.State;
