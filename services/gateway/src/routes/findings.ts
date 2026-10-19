import { RejectSuggestionRequestSchema, type ApplyAllFixesResult, type SuggestionDecision } from "@code-sentinel/contracts";
import { badGateway, badRequest, HttpError, notFound, type Logger } from "@code-sentinel/service-kit";
import { Router, type Request } from "express";
import { z } from "zod";

import { assertStepUp, requireOrganization, type StepUpPolicy } from "../auth/guards.js";
import type { GatewayResponse } from "../auth/principal.js";
import { applyAllFixes } from "../github/apply-all-fixes.js";
import { commitSuggestion } from "../github/apply-suggestion.js";
import type { GitHubClient, PullRequestInfo } from "../github/github-client.js";
import type { Stores, SuggestionRecord } from "../persistence/stores.js";

export interface FindingsRouterDeps {
  stores: Pick<Stores, "suggestions" | "repositories" | "reviews">;
  github: Pick<GitHubClient, "getPullRequest" | "getFileContent" | "updateFile" | "replyToReviewComment" | "commitFiles" | "commentOnPullRequest">;
  logger: Logger;
  stepUp: StepUpPolicy;
  /** Linked from the Apply all fixes comment on GitHub. */
  dashboardUrl?: string;
}

const FindingIdSchema = z.string().uuid();
const ReviewIdSchema = z.string().uuid();
const conflict = (code: string, message: string) => new HttpError(409, code, message);
const decided = () => conflict("suggestion_decided", "This fix was already accepted, dismissed, or replaced by a newer review");
const githubUnavailable = () => badGateway("github_unavailable", "GitHub did not answer; try again in a moment");

/**
 * UC-3: accept a suggested fix (commit it onto the pull request branch), reject it, or apply every
 * open fix of a review in one commit. Any member of the organization may decide; committing writes
 * code, so it also needs a TOTP step-up.
 */
export function createFindingsRouter({ stores, github, logger, stepUp, dashboardUrl }: FindingsRouterDeps): Router {
  const router = Router();

  // Another organization's finding answers 404, like an unknown one.
  const loadSuggestion = async (organizationId: string, findingId: string): Promise<SuggestionRecord> => {
    const id = FindingIdSchema.safeParse(findingId);
    const suggestion = id.success ? await stores.suggestions.findByFinding(organizationId, id.data) : undefined;
    if (!suggestion) throw notFound("finding_not_found", "No such finding with a fix in this organization");
    return suggestion;
  };

  router.post(
    "/findings/:findingId/suggestion/accept",
    requireOrganization,
    async (req: Request<{ findingId: string }>, res: GatewayResponse) => {
      const principal = res.locals.principal!;
      const suggestion = await loadSuggestion(principal.organizationId!, req.params.findingId);
      if (suggestion.state !== "proposed") throw decided();
      assertStepUp(principal, stepUp);

      const repository = await stores.repositories.findForOrganization(principal.organizationId!, suggestion.repositoryId);
      if (!repository || suggestion.prNumber === undefined) throw conflict("pull_request_closed", "This fix has no open pull request to commit to");
      const [owner = "", repo = ""] = repository.fullName.split("/");
      const ref = { ...(repository.githubInstallationNumber !== undefined ? { installationId: repository.githubInstallationNumber } : {}), owner, repo };
      const pullRef = { ...ref, pullNumber: suggestion.prNumber };

      let pull: PullRequestInfo | undefined;
      let result;
      try {
        pull = await github.getPullRequest(pullRef);
        if (!pull) throw conflict("pull_request_closed", "The pull request no longer exists");
        result = await commitSuggestion(github, { ref, repositoryFullName: repository.fullName, pull, suggestion });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        logger.warn("committing a fix failed", { requestId: res.locals.requestId, findingId: suggestion.findingId, error });
        throw githubUnavailable();
      }
      if (!result.ok) throw conflict(result.code, result.message);

      const at = new Date(stepUp.now());
      const recorded = await stores.suggestions.accept(suggestion.suggestionId, { userId: principal.userId, commitSha: result.commitSha, at });
      if (!recorded) {
        // Committed, but another decision landed first; the commit stands and a new review follows it.
        logger.warn("fix committed after another decision", { requestId: res.locals.requestId, suggestionId: suggestion.suggestionId });
        throw decided();
      }
      if (suggestion.githubCommentId !== undefined) {
        try {
          await github.replyToReviewComment(pullRef, suggestion.githubCommentId, `Applied in ${result.commitSha} from the Code Sentinel dashboard.`);
        } catch (error) {
          logger.warn("could not reply on the fix's comment", { requestId: res.locals.requestId, error });
        }
      }
      const body: SuggestionDecision = {
        findingId: suggestion.findingId,
        suggestionId: suggestion.suggestionId,
        state: "accepted",
        commitSha: result.commitSha,
        resolvedAt: at.toISOString(),
      };
      res.json(body);
    },
  );

  // Every open fix of a review in one commit, Style and AI alike; writes code, so it needs the step-up too.
  router.post("/reviews/:reviewId/apply-all-fixes", requireOrganization, async (req: Request<{ reviewId: string }>, res: GatewayResponse) => {
    const principal = res.locals.principal!;
    const id = ReviewIdSchema.safeParse(req.params.reviewId);
    const review = id.success ? await stores.reviews.get(principal.organizationId!, id.data) : undefined;
    if (!review) throw notFound("review_not_found", "No such review in this organization");
    assertStepUp(principal, stepUp);

    const repository = await stores.repositories.findForOrganization(principal.organizationId!, review.repositoryId);
    if (!repository) throw conflict("pull_request_closed", "This review's repository is no longer connected");
    let outcome;
    try {
      outcome = await applyAllFixes(
        { suggestions: stores.suggestions, github, now: () => new Date(stepUp.now()), ...(dashboardUrl ? { dashboardUrl } : {}) },
        { review, repository, userId: principal.userId, requestedBy: "a member on the Code Sentinel dashboard" },
      );
    } catch (error) {
      logger.warn("applying all fixes failed", { requestId: res.locals.requestId, reviewId: review.reviewId, error });
      throw githubUnavailable();
    }
    if (!outcome.ok) throw conflict(outcome.code, outcome.message);
    const body: ApplyAllFixesResult = {
      reviewId: review.reviewId,
      commitSha: outcome.commitSha,
      applied: outcome.applied,
      aiApplied: outcome.aiApplied,
      skipped: outcome.skipped,
    };
    res.json(body);
  });

  router.post(
    "/findings/:findingId/suggestion/reject",
    requireOrganization,
    async (req: Request<{ findingId: string }>, res: GatewayResponse) => {
      const parsed = RejectSuggestionRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw badRequest("invalid_body", "Send { reason?, comment? }", { issues: parsed.error.issues });
      const principal = res.locals.principal!;
      const suggestion = await loadSuggestion(principal.organizationId!, req.params.findingId);

      const at = new Date(stepUp.now());
      const recorded = await stores.suggestions.reject(suggestion.suggestionId, {
        userId: principal.userId,
        ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
        ...(parsed.data.comment ? { comment: parsed.data.comment } : {}),
        at,
      });
      if (!recorded) throw decided();
      const body: SuggestionDecision = {
        findingId: suggestion.findingId,
        suggestionId: suggestion.suggestionId,
        state: "rejected",
        resolvedAt: at.toISOString(),
      };
      res.json(body);
    },
  );

  return router;
}
