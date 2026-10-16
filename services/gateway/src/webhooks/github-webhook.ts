import type { WebhookAccepted, WebhookAction } from "@code-sentinel/contracts";
import { badGateway, badRequest, type Logger } from "@code-sentinel/service-kit";
import express, { Router, type Request } from "express";

import type { GatewayResponse } from "../auth/principal.js";
import { applyAllFixes } from "../github/apply-all-fixes.js";
import type { GitHubClient } from "../github/github-client.js";
import { APPLY_ALL_ACTION, type ReviewPublisher } from "../github/review-publisher.js";
import { OrchestratorCallError } from "../orchestrator/orchestrator-call-error.js";
import type { OrchestratorClientLike } from "../orchestrator/orchestrator-client.js";
import type { Stores } from "../persistence/stores.js";
import { matchesReviewBranches } from "./branch-match.js";
import { CheckRunActionEventSchema, isReviewAction, PullRequestEventSchema } from "./github-payload.js";
import { handleInstallationEvent } from "./installation-events.js";
import { pullRequestFromEvent } from "./review-job-request.js";
import { createSignatureMiddleware } from "./signature.js";
import { startPullRequestReview } from "./start-review.js";

export interface GithubWebhookRouterDeps {
  secret: string;
  stores: Pick<Stores, "repositories" | "repositoryConfig" | "installations" | "reviews" | "suggestions">;
  github: GitHubClient;
  orchestrator: Pick<OrchestratorClientLike, "createReviewJob" | "cancelReviewJob">;
  logger: Logger;
  /** Posts the finished review back to the pull request; omitted in tests that do not publish. */
  publisher?: Pick<ReviewPublisher, "follow" | "nothingToReview">;
  now?: () => Date;
  fileContentMaxBytes?: number;
}

/**
 * `POST /webhooks/github`: signature first, then installation events (A6), the Check Run's "Apply all
 * fixes" button, or the decision tree of `seq_uc1_pr_review.mmd` (FR-GW-03/04, FR-GH-01).
 */
export function createGithubWebhookRouter({
  secret,
  stores,
  github,
  orchestrator,
  logger,
  publisher,
  fileContentMaxBytes,
  now = () => new Date(),
}: GithubWebhookRouterDeps): Router {
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

      if (event === "installation" || event === "installation_repositories") {
        let outcome;
        try {
          outcome = await handleInstallationEvent(event, payload, { github, installations: stores.installations, now });
        } catch (error) {
          // Answering 502 marks the delivery failed on GitHub, so it can be redelivered once GitHub recovers.
          logger.warn("installation sync failed", { requestId: res.locals.requestId, deliveryId, error });
          throw reject("installation_sync_failed", badGateway("github_unavailable", "The installation could not be synced"));
        }
        if (outcome === "invalid_payload") {
          throw reject("invalid_payload", badRequest("invalid_payload", `Payload is not a valid ${event} event`));
        }
        accept(outcome, outcome === "event_ignored" ? "event_ignored" : "installation_synced");
        return;
      }

      if (event === "check_run" && action === "requested_action") {
        const clicked = CheckRunActionEventSchema.safeParse(payload);
        if (!clicked.success || clicked.data.requested_action.identifier !== APPLY_ALL_ACTION) {
          accept("event_ignored", "event_ignored");
          return;
        }
        const { check_run, repository: repo, sender } = clicked.data;
        const [review, repository] = await Promise.all([stores.reviews.findByCheckRun(check_run.id), stores.repositories.findByGithubRepoId(repo.id)]);
        if (!review || !repository || review.repositoryId !== repository.repositoryId) {
          accept("review_unknown", "event_ignored");
          return;
        }
        logFields.reviewId = review.reviewId;
        // GitHub only offers the button to people with write access, and waits ~10 s for an answer: commit in the background.
        void applyAllFixes({ suggestions: stores.suggestions, github, now }, { review, repository, requestedBy: `@${sender.login} (Check Run)` })
          .then((outcome) => logger.info("apply all fixes", { requestId: res.locals.requestId, reviewId: review.reviewId, ...outcome }))
          .catch((error: unknown) => logger.warn("apply all fixes failed", { requestId: res.locals.requestId, reviewId: review.reviewId, error }));
        accept("fixes_applying", "fixes_applying", review.reviewId);
        return;
      }

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
      const baseRef = pullRequest.pull_request.base.ref;
      if (!matchesReviewBranches(baseRef, config.reviewBranches)) {
        logFields.baseRef = baseRef;
        accept("branch_ignored", "branch_ignored");
        return;
      }

      const ref = {
        ...(pullRequest.installation ? { installationId: pullRequest.installation.id } : {}),
        owner: pullRequest.repository.owner.login,
        repo: pullRequest.repository.name,
        pullNumber: pullRequest.number,
      };
      try {
        // The follow-ups (Check Run, cancelling the older review) run in the background, so GitHub gets its 202 fast.
        const result = await startPullRequestReview(
          { stores, github, orchestrator, logger, ...(publisher ? { publisher } : {}), ...(fileContentMaxBytes !== undefined ? { fileContentMaxBytes } : {}) },
          {
            repository,
            config,
            ref,
            pullRequest: pullRequestFromEvent(pullRequest),
            trigger: "github_pull_request",
            idempotencyKey: deliveryId,
            requestId: res.locals.requestId,
            logFields,
          },
        );
        if (result.outcome === "no_reviewable_files") {
          accept("no_reviewable_files", "event_ignored");
          return;
        }
        logFields.reviewId = result.job.reviewId;
        accept(result.outcome, result.outcome, result.job.reviewId);
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

