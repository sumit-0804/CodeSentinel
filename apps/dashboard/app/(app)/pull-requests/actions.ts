"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PullRequestReviewRequestSchema, ReviewAcceptedSchema } from "@code-sentinel/contracts";
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
