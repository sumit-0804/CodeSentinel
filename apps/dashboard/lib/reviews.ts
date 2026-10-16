import "server-only";
import { cache } from "react";
import {
  BranchListResponseSchema,
  PullRequestListResponseSchema,
  ReviewDetailSchema,
  ReviewListResponseSchema,
  type BranchListResponse,
  type PullRequestListItem,
  type ReviewDetail,
  type ReviewListItem,
} from "@code-sentinel/contracts";
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

export type OpenPullRequestsResult = { ok: true; pulls: PullRequestListItem[] } | { ok: false; reason: GatewayFailure; code?: string };

/** The repository's open pull requests from GitHub, each with its newest review. */
export const getOpenPullRequests = cache(async (repositoryId: string): Promise<OpenPullRequestsResult> => {
  const account = await getAccount();
  if (!account.ok) return account;
  if (!account.current) return { ok: true, pulls: [] };

  const listed = await gatewayFetch(`/v1/repositories/${encodeURIComponent(repositoryId)}/pulls`, PullRequestListResponseSchema, {
    organizationId: account.current.organizationId,
  });
  if (!listed.ok) return { ok: false, reason: listed.reason, ...(listed.code ? { code: listed.code } : {}) };
  return { ok: true, pulls: listed.data.items };
});

/** The repository's branch names from GitHub for the branch picker; `undefined` when they couldn't be loaded. */
export const getBranches = cache(async (repositoryId: string): Promise<BranchListResponse | undefined> => {
  const account = await getAccount();
  if (!account.ok || !account.current) return undefined;

  const listed = await gatewayFetch(`/v1/repositories/${encodeURIComponent(repositoryId)}/branches`, BranchListResponseSchema, {
    organizationId: account.current.organizationId,
  });
  return listed.ok ? listed.data : undefined;
});

export const getReview = cache(async (reviewId: string): Promise<ReviewResult> => {
  const account = await getAccount();
  if (!account.ok) return account;
  if (!account.current) return { ok: false, reason: "not_found" };

  const found = await gatewayFetch(`/v1/reviews/${encodeURIComponent(reviewId)}`, ReviewDetailSchema, { organizationId: account.current.organizationId });
  if (!found.ok) return { ok: false, reason: found.status === 404 ? "not_found" : found.reason };
  return { ok: true, review: found.data };
});
