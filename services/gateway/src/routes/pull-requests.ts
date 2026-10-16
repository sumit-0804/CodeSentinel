import { randomUUID } from "node:crypto";

import {
  PullRequestReviewRequestSchema,
  type BranchListResponse,
  type PullRequestListItem,
  type PullRequestListResponse,
  type ReviewAccepted,
} from "@code-sentinel/contracts";
import { badGateway, badRequest, HttpError, notFound, unprocessable, type Logger } from "@code-sentinel/service-kit";
import { Router, type Request } from "express";
import { z } from "zod";

import { requireOrganization } from "../auth/guards.js";
import type { GatewayResponse } from "../auth/principal.js";
import type { GitHubClient, PullRequestInfo, RepositoryRef } from "../github/github-client.js";
import type { ReviewPublisher } from "../github/review-publisher.js";
import { OrchestratorCallError } from "../orchestrator/orchestrator-call-error.js";
import type { OrchestratorClientLike } from "../orchestrator/orchestrator-client.js";
import type { RepositoryRecord, Stores } from "../persistence/stores.js";
import { matchesReviewBranches } from "../webhooks/branch-match.js";
import { startPullRequestReview } from "../webhooks/start-review.js";
import { toListItem } from "./review-view.js";

/** Open pull requests listed per repository, and how long GitHub's answer is reused. */
const OPEN_PULLS_LIMIT = 50;
const PULLS_CACHE_MS = 30_000;
/** Branches listed for the branch picker; the rest can still be typed. */
const BRANCHES_LIMIT = 300;
const BRANCHES_CACHE_MS = 60_000;
/** A second re-run of the same pull request within this window is refused, so a double click runs one review. */
const RERUN_GUARD_MS = 30_000;

const RepositoryIdSchema = z.string().uuid();

export interface PullRequestsRouterDeps {
  stores: Pick<Stores, "repositories" | "repositoryConfig" | "reviews">;
  github: Pick<GitHubClient, "getPullRequest" | "listOpenPullRequests" | "listBranches" | "listPullRequestFiles" | "getFileContent">;
  orchestrator: Pick<OrchestratorClientLike, "createReviewJob" | "cancelReviewJob">;
  logger: Logger;
  publisher?: Pick<ReviewPublisher, "follow" | "nothingToReview">;
  now?: () => Date;
  fileContentMaxBytes?: number;
}

const conflict = (code: string, message: string) => new HttpError(409, code, message);
const githubUnavailable = () => badGateway("github_unavailable", "GitHub did not answer; try again in a moment");

function repositoryRef(repository: RepositoryRecord): RepositoryRef {
  const [owner = "", repo = ""] = repository.fullName.split("/");
  return { ...(repository.githubInstallationNumber !== undefined ? { installationId: repository.githubInstallationNumber } : {}), owner, repo };
}

/**
 * Pull requests from the dashboard (Phase B): `GET /v1/repositories/{id}/pulls` lists the open ones
 * from GitHub with their newest review, and `POST /v1/reviews` re-runs a review of one. Both are
 * scoped to the caller's organization (NFR-13).
 */
export function createPullRequestsRouter(deps: PullRequestsRouterDeps): Router {
  const { stores, github, logger, now = () => new Date() } = deps;
  const router = Router();
  const pullsCache = new Map<string, { at: number; pulls: PullRequestInfo[] }>();
  const branchesCache = new Map<string, { at: number; body: BranchListResponse }>();

  const loadRepository = async (organizationId: string, repositoryId: unknown) => {
    const id = RepositoryIdSchema.safeParse(repositoryId);
    const repository = id.success ? await stores.repositories.findForOrganization(organizationId, id.data) : undefined;
    if (!repository) throw notFound("repository_not_found", "No such repository in this organization");
    return repository;
  };

  router.get("/repositories/:repositoryId/pulls", requireOrganization, async (req: Request<{ repositoryId: string }>, res: GatewayResponse) => {
    const organizationId = res.locals.principal!.organizationId!;
    const repository = await loadRepository(organizationId, req.params.repositoryId);

    let cached = pullsCache.get(repository.repositoryId);
    if (!cached || now().getTime() - cached.at > PULLS_CACHE_MS) {
      try {
        cached = { at: now().getTime(), pulls: await github.listOpenPullRequests(repositoryRef(repository), OPEN_PULLS_LIMIT) };
      } catch (error) {
        logger.warn("listing open pull requests failed", { requestId: res.locals.requestId, repositoryId: repository.repositoryId, error });
        throw githubUnavailable();
      }
      pullsCache.set(repository.repositoryId, cached);
    }

    const [config, latest] = await Promise.all([
      stores.repositoryConfig.getEffectiveConfig(repository.repositoryId),
      stores.reviews.list(organizationId, { repositoryId: repository.repositoryId, latest: true, limit: 100, offset: 0 }),
    ]);
    const byNumber = new Map(latest.rows.map((row) => [row.prNumber, row]));
    const items: PullRequestListItem[] = cached.pulls.map((pull) => {
      const review = byNumber.get(pull.number);
      return {
        number: pull.number,
        title: pull.title,
        ...(pull.author ? { author: pull.author } : {}),
        headSha: pull.headSha,
        headRef: pull.headRef,
        baseRef: pull.baseRef,
        draft: pull.draft,
        updatedAt: new Date(pull.updatedAt).toISOString(),
        htmlUrl: pull.htmlUrl,
        reviewable: config ? matchesReviewBranches(pull.baseRef, config.reviewBranches) : false,
        latestReview: review ? toListItem(review) : null,
      };
    });
    const body: PullRequestListResponse = { items };
    res.json(body);
  });

  router.get("/repositories/:repositoryId/branches", requireOrganization, async (req: Request<{ repositoryId: string }>, res: GatewayResponse) => {
    const repository = await loadRepository(res.locals.principal!.organizationId!, req.params.repositoryId);

    let cached = branchesCache.get(repository.repositoryId);
    if (!cached || now().getTime() - cached.at > BRANCHES_CACHE_MS) {
      let names: string[];
      try {
        // One past the limit tells whether GitHub had more.
        names = await github.listBranches(repositoryRef(repository), BRANCHES_LIMIT + 1);
      } catch (error) {
        logger.warn("listing branches failed", { requestId: res.locals.requestId, repositoryId: repository.repositoryId, error });
        throw githubUnavailable();
      }
      const items = names.slice(0, BRANCHES_LIMIT).sort((a, b) => a.localeCompare(b));
      cached = { at: now().getTime(), body: { items, truncated: names.length > BRANCHES_LIMIT } };
      branchesCache.set(repository.repositoryId, cached);
    }
    res.json(cached.body);
  });

  router.post("/reviews", requireOrganization, async (req: Request, res: GatewayResponse) => {
    const parsed = PullRequestReviewRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("invalid_body", "Send { repositoryId, pullRequestNumber }", { issues: parsed.error.issues });
    }
    const { userId, organizationId } = res.locals.principal!;
    const requestId = res.locals.requestId;
    const repository = await loadRepository(organizationId!, parsed.data.repositoryId);
    const logFields: Record<string, unknown> = { repository: repository.fullName, pullRequestNumber: parsed.data.pullRequestNumber };
    res.locals.logFields = logFields;

    const config = await stores.repositoryConfig.getEffectiveConfig(repository.repositoryId);
    if (!repository.reviewEnabled || !config || config.enabledAgents.length === 0) {
      throw conflict("repository_disabled", "Reviews are off for this repository, or every agent is off");
    }

    const ref = { ...repositoryRef(repository), pullNumber: parsed.data.pullRequestNumber };
    let pull: PullRequestInfo | undefined;
    try {
      pull = await github.getPullRequest(ref);
    } catch (error) {
      logger.warn("reading the pull request failed", { requestId, error });
      throw githubUnavailable();
    }
    if (!pull || pull.state !== "open") throw notFound("pull_request_not_found", "That pull request isn't open on GitHub");
    if (!matchesReviewBranches(pull.baseRef, config.reviewBranches)) {
      throw conflict("branch_ignored", `Pull requests into ${pull.baseRef} aren't reviewed in this repository`);
    }

    const active = await stores.reviews.activeForPullRequest(repository.repositoryId, pull.number);
    if (active.some((review) => now().getTime() - review.createdAt.getTime() < RERUN_GUARD_MS)) {
      throw conflict("review_in_progress", "A review of this pull request just started");
    }

    let result;
    try {
      result = await startPullRequestReview(
        {
          stores,
          github,
          orchestrator: deps.orchestrator,
          logger,
          ...(deps.publisher ? { publisher: deps.publisher } : {}),
          ...(deps.fileContentMaxBytes !== undefined ? { fileContentMaxBytes: deps.fileContentMaxBytes } : {}),
        },
        {
          repository,
          config,
          ref,
          pullRequest: { number: pull.number, title: pull.title, headSha: pull.headSha, baseSha: pull.baseSha, headRef: pull.headRef, baseRef: pull.baseRef },
          trigger: "dashboard_manual",
          triggeredByUserId: userId,
          idempotencyKey: `rerun-${randomUUID()}`,
          requestId,
          logFields,
        },
      );
    } catch (error) {
      if (error instanceof OrchestratorCallError) {
        logger.warn("orchestrator call failed", { requestId, kind: error.kind, error });
        throw badGateway("orchestrator_unavailable", "The review could not be started");
      }
      // Anything else here is GitHub failing to list the pull request's files.
      logger.warn("listing the pull request's files failed", { requestId, error });
      throw githubUnavailable();
    }
    if (result.outcome === "no_reviewable_files") {
      logFields.outcome = "no_reviewable_files";
      throw unprocessable("no_reviewable_files", "Every changed file is skipped, so there's nothing to review");
    }
    logFields.outcome = result.outcome;
    logFields.reviewId = result.job.reviewId;
    const body: ReviewAccepted = { reviewId: result.job.reviewId, status: result.job.status === "running" ? "running" : "queued" };
    res.status(202).json(body);
  });

  return router;
}
