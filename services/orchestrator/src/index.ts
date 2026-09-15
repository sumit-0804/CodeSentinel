/**
 * @code-sentinel/orchestrator
 *
 * Public surface of the orchestrator service: the LangGraph `ReviewGraph` that fans a review out
 * to the agent services and returns one `CombinedReport`, the `AgentClient` it calls them with,
 * and the aggregation and context building blocks the graph's nodes use. The HTTP layer
 * (`ReviewJobController` per `docs/design/openapi/orchestrator.yaml`) is added on top of these.
 *
 * Shared shapes (`Finding`, `CombinedReport`, ...) are not re-exported; import them from
 * `@code-sentinel/contracts`.
 */

export {
  aggregate,
  buildReviewSummary,
  deriveStatus,
  FindingAggregator,
  mergeSkippedFiles,
  SeverityRanker,
} from "./aggregation/index.js";
export type { AgentSkippedFiles, AggregateInput } from "./aggregation/index.js";
export {
  AgentCallError,
  AgentClient,
  createAgentClients,
  loadAgentConfig,
} from "./agents/index.js";
export type {
  AgentCallErrorKind,
  AgentCallOptions,
  AgentClientOptions,
  AgentConfig,
  FetchLike,
} from "./agents/index.js";
export { SimilarIssueLookup } from "./context/similar-issue-lookup.js";
export {
  ChromaVectorRepository,
  type VectorRepository,
} from "./context/vector-repository.js";
export {
  ALL_AGENTS,
  buildReviewGraph,
  DEADLINE_MARGIN_MS,
  DEFAULT_AGENT_TIMEOUT_MS,
  DEFAULT_CONFIDENCE_THRESHOLD,
  ReviewStateAnnotation,
  toInitialState,
} from "./graph/index.js";
export type {
  ReviewClient,
  ReviewClients,
  ReviewGraphDeps,
  ReviewRunInput,
  ReviewState,
} from "./graph/index.js";
