import type { ReviewJobRequestInput } from "@code-sentinel/contracts";

import type { EffectiveRepositoryConfig, RepositoryRecord } from "../persistence/stores.js";
import type { FilteredFiles } from "./file-filter.js";
import type { PullRequestEvent } from "./github-payload.js";

export interface BuildReviewJobRequestInput {
  repository: RepositoryRecord;
  config: EffectiveRepositoryConfig;
  event: PullRequestEvent;
  filtered: FilteredFiles;
}

/** The orchestrator job for a pull request event, carrying the tenant ids on every job (NFR-13). */
export function buildReviewJobRequest({ repository, config, event, filtered }: BuildReviewJobRequestInput): ReviewJobRequestInput {
  return {
    repositoryId: repository.repositoryId,
    organizationId: repository.organizationId,
    trigger: "github_pull_request",
    pullRequest: {
      number: event.number,
      title: event.pull_request.title,
      headRef: event.pull_request.head.ref,
      baseRef: event.pull_request.base.ref,
    },
    headSha: event.pull_request.head.sha,
    baseSha: event.pull_request.base.sha,
    files: filtered.files,
    ...(filtered.skippedFiles.length > 0 ? { skippedFiles: filtered.skippedFiles } : {}),
    enabledAgents: config.enabledAgents,
    confidenceThreshold: config.confidenceThreshold,
    agentTimeoutMs: config.agentTimeoutMs,
  };
}
