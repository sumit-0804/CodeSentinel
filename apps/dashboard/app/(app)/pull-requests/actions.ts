"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ApplyAllFixesResultSchema,
  PullRequestReviewRequestSchema,
  RejectSuggestionRequestSchema,
  ReviewAcceptedSchema,
  SuggestionDecisionSchema,
} from "@code-sentinel/contracts";
import { fixFailureMessage } from "@/lib/fix-messages";
import { gatewayFetch } from "@/lib/gateway";
import { getAccount } from "@/lib/organization";
import { rerunFailureMessage } from "@/lib/rerun-messages";

export type RerunResult = { ok: true; reviewId: string } | { ok: false; message: string };

/** Starts a new review of an open pull request's head commit (trigger `dashboard_manual`); any member may. */
export async function rerunReview(repositoryId: string, pullRequestNumber: number): Promise<RerunResult> {
  const parsed = PullRequestReviewRequestSchema.safeParse({ repositoryId, pullRequestNumber });
  if (!parsed.success || !z.string().uuid().safeParse(repositoryId).success) return { ok: false, message: "That pull request isn't valid." };
  const account = await getAccount();
  if (!account.ok || !account.current) return { ok: false, message: "Choose an organization first." };

  const result = await gatewayFetch("/v1/reviews", ReviewAcceptedSchema, {
    method: "POST",
    body: JSON.stringify(parsed.data),
    headers: { "Content-Type": "application/json" },
    organizationId: account.current.organizationId,
  });
  if (!result.ok) return { ok: false, message: rerunFailureMessage(result) };
  revalidatePath("/pull-requests", "layout");
  revalidatePath("/repositories", "layout");
  return { ok: true, reviewId: result.data.reviewId };
}

/** `code: "mfa_required"` lets `useStepUp` ask for an authenticator code and try again. */
export type FixDecisionResult = { ok: true; commitSha?: string } | { ok: false; message: string; code?: string };

const FindingIdSchema = z.string().uuid();

async function decide(findingId: string, action: "accept" | "reject", body: unknown): Promise<FixDecisionResult> {
  if (!FindingIdSchema.safeParse(findingId).success) return { ok: false, message: "That finding isn't valid." };
  const account = await getAccount();
  if (!account.ok || !account.current) return { ok: false, message: "Choose an organization first." };

  const result = await gatewayFetch(`/v1/findings/${findingId}/suggestion/${action}`, SuggestionDecisionSchema, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    organizationId: account.current.organizationId,
  });
  if (!result.ok) return { ok: false, message: fixFailureMessage(result), ...(result.code ? { code: result.code } : {}) };
  revalidatePath("/pull-requests", "layout");
  return { ok: true, ...(result.data.commitSha ? { commitSha: result.data.commitSha } : {}) };
}

/** Commits a suggested fix onto the pull request branch (UC-3); the gateway asks for an authenticator code. */
export async function commitFix(findingId: string): Promise<FixDecisionResult> {
  return decide(findingId, "accept", {});
}

export type ApplyAllResult = { ok: true; commitSha: string; applied: number; aiApplied: number; skipped: number } | { ok: false; message: string; code?: string };

/** Commits every open fix of the review, Style and AI alike, in one commit; the gateway asks for an authenticator code. */
export async function applyAllFixes(reviewId: string): Promise<ApplyAllResult> {
  if (!z.string().uuid().safeParse(reviewId).success) return { ok: false, message: "That review isn't valid." };
  const account = await getAccount();
  if (!account.ok || !account.current) return { ok: false, message: "Choose an organization first." };

  const result = await gatewayFetch(`/v1/reviews/${reviewId}/apply-all-fixes`, ApplyAllFixesResultSchema, {
    method: "POST",
    body: "{}",
    headers: { "Content-Type": "application/json" },
    organizationId: account.current.organizationId,
  });
  if (!result.ok) return { ok: false, message: fixFailureMessage(result), ...(result.code ? { code: result.code } : {}) };
  revalidatePath("/pull-requests", "layout");
  const { commitSha, applied, aiApplied, skipped } = result.data;
  return { ok: true, commitSha, applied, aiApplied, skipped };
}

/** Dismisses a suggested fix with an optional reason; no code is written. */
export async function dismissFix(findingId: string, reason: string, comment: string): Promise<FixDecisionResult> {
  const parsed = RejectSuggestionRequestSchema.safeParse({ reason, ...(comment.trim() ? { comment: comment.trim() } : {}) });
  if (!parsed.success) return { ok: false, message: "Choose a reason, and keep the comment under 1000 characters." };
  return decide(findingId, "reject", parsed.data);
}
