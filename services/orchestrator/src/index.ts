/**
 * @code-sentinel/orchestrator
 *
 * Public surface of the orchestrator service. The HTTP layer (`ReviewJobController` and the
 * LangGraph `ReviewGraph` per `docs/design/openapi/orchestrator.yaml`) is added on top of these
 * building blocks as the Orchestration & Data Layer work package progresses.
 */

export * from "./types.js";
export {
  aggregate,
  buildReviewSummary,
  FindingAggregator,
  SeverityRanker,
} from "./aggregation/index.js";
export type { AggregateInput } from "./aggregation/index.js";
export { SimilarIssueLookup } from "./context/similar-issue-lookup.js";
export {
  ChromaVectorRepository,
  type VectorRepository,
} from "./context/vector-repository.js";
