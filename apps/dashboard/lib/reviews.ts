import "server-only";
import { cache } from "react";
import { ReviewDetailSchema, ReviewListResponseSchema, type ReviewDetail, type ReviewListItem } from "@code-sentinel/contracts";
import { gatewayFetch, type GatewayFailure } from "@/lib/gateway";
import { getAccount } from "@/lib/organization";

export type ReviewsResult = { ok: true; reviews: ReviewListItem[]; total: number } | { ok: false; reason: GatewayFailure };
export type ReviewResult = { ok: true; review: ReviewDetail } | { ok: false; reason: GatewayFailure | "not_found" };

/** The current organization's reviews, newest first; `latest` keeps each pull request's newest only. */
export const getReviews = cache(async (latest: boolean, repositoryId?: string, limit = 100): Promise<ReviewsResult> => {
  const account = await getAccount();
  if (!account.ok) return account;
  if (!account.current) return { ok: true, reviews: [], total: 0 };

  const query = new URLSearchParams({ latest: String(latest), limit: String(limit) });
  if (repositoryId) query.set("repositoryId", repositoryId);
  const listed = await gatewayFetch(`/v1/reviews?${query}`, ReviewListResponseSchema, { organizationId: account.current.organizationId });
  if (!listed.ok) return { ok: false, reason: listed.reason };
  return { ok: true, reviews: listed.data.items, total: listed.data.pageInfo.total };
});

export const getReview = cache(async (reviewId: string): Promise<ReviewResult> => {
  const account = await getAccount();
  if (!account.ok) return account;
  if (!account.current) return { ok: false, reason: "not_found" };

  const found = await gatewayFetch(`/v1/reviews/${encodeURIComponent(reviewId)}`, ReviewDetailSchema, { organizationId: account.current.organizationId });
  if (!found.ok) return { ok: false, reason: found.status === 404 ? "not_found" : found.reason };
  return { ok: true, review: found.data };
});
