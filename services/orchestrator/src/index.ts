/**
 * @code-sentinel/orchestrator
 *
 * Public surface of the orchestrator service: the HTTP app and `ReviewJobController`
 * (`docs/design/openapi/orchestrator.yaml`), the LangGraph `ReviewGraph` that fans a review out to
 * the agent services and returns one `CombinedReport`, the `AgentClient` it calls them with, and
 * the aggregation and context building blocks the graph's nodes use.
 *
 * Shared shapes (`Finding`, `CombinedReport`, ...) are not re-exported; import them from
 * `@code-sentinel/contracts`.
 */

export { createApp, DEFAULT_VERSION, type AppDeps } from "./app.js";
export { loadOrchestratorConfig, OrchestratorConfigError, type OrchestratorConfig } from "./config.js";
export { InMemoryJobStore, isTerminal, ORPHANED_ERROR, type JobStore } from "./jobs/job-store.js";
export { PrismaJobStore } from "./jobs/prisma-job-store.js";
export {
  ReviewJobController,
  type CreatedJob,
  type CreateJobOptions,
  type RunReview,
} from "./jobs/review-job-controller.js";
export {
  createLlmRouting,
  LLM_AGENTS,
  reserveBatch,
  settleCall,
  type LlmRouting,
  type ReservedCall,
} from "./budget/llm-routing.js";
export { planLlmReview, type LlmBatch, type LlmReviewPlan, type PlanLimits } from "./budget/plan.js";
export {
  aggregate,
  buildCoverage,
  buildReviewSummary,
  countChangedLines,
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
export {
  SimilarIssueLookup,
  type LookupScope,
  type SimilarIssueLookupOptions,
} from "./context/similar-issue-lookup.js";
export { PgVectorRepository, type Embedder, type PgVectorRepositoryOptions } from "./context/pgvector-repository.js";
export type { SimilarityScope, StoredFinding, VectorRepository } from "./context/vector-repository.js";
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
  NodeRunConfig,
  ReviewClient,
  ReviewClients,
  ReviewGraphDeps,
  ReviewRunInput,
  ReviewRunOptions,
  ReviewState,
} from "./graph/index.js";
