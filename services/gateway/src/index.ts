/** @code-sentinel/gateway: webhook receipt, auth and routing to the orchestrator (FR-GW-01…04). */

export { createApp, type AppDeps } from "./app.js";
export { GatewayConfigError, loadGatewayConfig, type GatewayConfig } from "./config.js";
export { createJsonLogger, noopLogger, type Logger } from "./logging/logger.js";
export { HttpError } from "./http/errors.js";
export { OrchestratorCallError } from "./orchestrator/orchestrator-call-error.js";
export { OrchestratorClient, type OrchestratorClientLike } from "./orchestrator/orchestrator-client.js";
export { signSessionToken } from "./auth/session-token.js";
export { verifyGithubSignature } from "./webhooks/signature.js";
export { filterPullRequestFiles } from "./webhooks/file-filter.js";
export { buildReviewJobRequest } from "./webhooks/review-job-request.js";
export type { GitHubClient, PullRequestFile, PullRequestRef } from "./github/github-client.js";
export { StubGitHubClient } from "./github/stub-github-client.js";
export { InMemoryStores, type StoreSeed } from "./persistence/in-memory.js";
export type {
  ApiKeyStore,
  RepositoryConfigStore,
  RepositoryStore,
  SessionStore,
  Stores,
  UserStore,
} from "./persistence/stores.js";
