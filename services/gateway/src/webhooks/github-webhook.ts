import type { WebhookAccepted, WebhookAction } from "@code-sentinel/contracts";
import express, { Router, type Request } from "express";

import type { GatewayResponse } from "../auth/principal.js";
import type { GitHubClient } from "../github/github-client.js";
import { badGateway, badRequest } from "../http/errors.js";
import type { Logger } from "../logging/logger.js";
import { OrchestratorCallError } from "../orchestrator/orchestrator-call-error.js";
import type { OrchestratorClientLike } from "../orchestrator/orchestrator-client.js";
import type { Stores } from "../persistence/stores.js";
import { filterPullRequestFiles } from "./file-filter.js";
import { isReviewAction, PullRequestEventSchema } from "./github-payload.js";
import { buildReviewJobRequest } from "./review-job-request.js";
import { createSignatureMiddleware } from "./signature.js";

export interface GithubWebhookRouterDeps {
  secret: string;
  stores: Pick<Stores, "repositories" | "repositoryConfig">;
  github: GitHubClient;
  orchestrator: Pick<OrchestratorClientLike, "createReviewJob">;
  logger: Logger;
}

/** `POST /webhooks/github`: signature first, then the decision tree of `seq_uc1_pr_review.mmd` (FR-GW-03/04, FR-GH-01). */
export function createGithubWebhookRouter({ secret, stores, github, orchestrator, logger }: GithubWebhookRouterDeps): Router {
  const router = Router();

  router.post(
    "/webhooks/github",
    express.raw({ type: "*/*", limit: "1mb" }),
    createSignatureMiddleware(secret),
    async (req: Request, res: GatewayResponse) => {
      const event = req.get("x-github-event");
      const deliveryId = req.get("x-github-delivery");
      const logFields: Record<string, unknown> = { deliveryId, event };
      res.locals.logFields = logFields;

      // `outcome` is what the log line records; `action` is what GitHub receives.
      const accept = (outcome: string, action: WebhookAction, reviewId?: string) => {
        logFields.outcome = outcome;
        const body: WebhookAccepted = { accepted: true, ...(reviewId ? { reviewId } : {}), action };
        res.status(202).json(body);
      };
      const reject = (outcome: string, error: Error) => {
        logFields.outcome = outcome;
        return error;
      };

      if (!event || !deliveryId) {
        throw reject("missing_header", badRequest("missing_header", "X-GitHub-Event and X-GitHub-Delivery are required"));
      }

      let payload: unknown;
      try {
        payload = JSON.parse((req.body as Buffer).toString("utf8"));
      } catch {
        throw reject("invalid_payload", badRequest("invalid_payload", "Webhook body is not valid JSON"));
      }

      const action = (payload as { action?: unknown } | null)?.action;
      logFields.action = typeof action === "string" ? action : undefined;
      if (event !== "pull_request" || !isReviewAction(action)) {
        accept("event_ignored", "event_ignored");
        return;
      }

      const parsed = PullRequestEventSchema.safeParse(payload);
      if (!parsed.success) {
        throw reject(
          "invalid_payload",
          badRequest("invalid_payload", "Payload is not a valid pull_request event", { issues: parsed.error.issues }),
        );
      }
      const pullRequest = parsed.data;
      logFields.repository = pullRequest.repository.full_name;
      logFields.pullRequestNumber = pullRequest.number;

      const repository = await stores.repositories.findByGithubRepoId(pullRequest.repository.id);
      if (!repository) {
        accept("repository_unknown", "event_ignored");
        return;
      }
      if (!repository.reviewEnabled) {
        accept("repository_disabled", "repository_disabled");
        return;
      }

      // No enabled agents means the orchestrator would answer 422, so it is not called.
      const config = await stores.repositoryConfig.getEffectiveConfig(repository.repositoryId);
      if (!config || config.enabledAgents.length === 0) {
        accept("repository_disabled", "repository_disabled");
        return;
      }

      const filtered = filterPullRequestFiles(
        await github.listPullRequestFiles({
          ...(pullRequest.installation ? { installationId: pullRequest.installation.id } : {}),
          owner: pullRequest.repository.owner.login,
          repo: pullRequest.repository.name,
          pullNumber: pullRequest.number,
        }),
      );
      logFields.files = filtered.files.length;
      logFields.skippedFiles = countByReason(filtered.skippedFiles);
      // Interim: the design finishes an all-filtered review with an empty report, which needs the review store.
      if (filtered.files.length === 0) {
        accept("no_reviewable_files", "event_ignored");
        return;
      }

      try {
        const { job, created } = await orchestrator.createReviewJob(
          buildReviewJobRequest({ repository, config, event: pullRequest, filtered }),
          { idempotencyKey: deliveryId, requestId: res.locals.requestId },
        );
        logFields.reviewId = job.reviewId;
        if (created) accept("review_started", "review_started", job.reviewId);
        else accept("duplicate_ignored", "duplicate_ignored", job.reviewId);
      } catch (error) {
        if (!(error instanceof OrchestratorCallError)) throw error;
        const details = { kind: error.kind, ...(error.status !== undefined ? { status: error.status } : {}) };
        logger.warn("orchestrator call failed", { requestId: res.locals.requestId, deliveryId, ...details, error });
        throw reject("orchestrator_unavailable", badGateway("orchestrator_unavailable", "The review could not be started", details));
      }
    },
  );

  return router;
}

function countByReason(skippedFiles: { reason: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { reason } of skippedFiles) counts[reason] = (counts[reason] ?? 0) + 1;
  return counts;
}
