import { randomUUID } from "node:crypto";

import { ReviewDetailSchema, ReviewListResponseSchema } from "@code-sentinel/contracts";
import { EXAMPLE_ORGANIZATION_ID, EXAMPLE_REPOSITORY_ID, exampleCombinedReport } from "@code-sentinel/contracts/examples";
import { withServer } from "@code-sentinel/service-kit/testing";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import type { SeedReview, StoreSeed } from "../persistence/in-memory.js";
import { seededStores, testAppDeps } from "../test-support/fixtures.js";

const review = (prNumber: number, minutesAgo: number, overrides: Partial<SeedReview> = {}): SeedReview => ({
  reviewId: randomUUID(),
  organizationId: EXAMPLE_ORGANIZATION_ID,
  repositoryId: EXAMPLE_REPOSITORY_ID,
  trigger: "github_pull_request",
  prNumber,
  prTitle: `PR ${prNumber}`,
  headSha: randomUUID().replaceAll("-", ""),
  status: "completed",
  confidenceThreshold: 0.8,
  createdAt: new Date(Date.now() - minutesAgo * 60_000),
  report: exampleCombinedReport,
  ...overrides,
});

/** Calls the gateway with the seeded API key, which belongs to the example organization. */
async function get(path: string, edit: (seed: StoreSeed) => void = () => {}) {
  const seeded = await seededStores(edit);
  let result!: { status: number; body: Record<string, unknown> };
  await withServer(createApp(testAppDeps({ stores: seeded.stores })), async (baseUrl) => {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${seeded.apiKey}` } });
    result = { status: response.status, body: (await response.json()) as Record<string, unknown> };
  });
  return result;
}

describe("GET /v1/reviews", () => {
  it("lists newest first with a page, and keeps each pull request's newest with latest=true", async () => {
    const reviews = [review(4, 30), review(4, 5, { prTitle: "PR 4 again", checkConclusion: "fail" }), review(5, 10)];
    const edit = (seed: StoreSeed) => seed.reviews.push(...reviews);

    const all = ReviewListResponseSchema.parse((await get("/v1/reviews?limit=2", edit)).body);
    expect(all.pageInfo).toEqual({ total: 3, limit: 2, offset: 0 });
    expect(all.items.map((i) => i.pullRequestTitle)).toEqual(["PR 4 again", "PR 5"]);
    expect(all.items[0]).toMatchObject({ checkConclusion: "fail", repositoryFullName: "code-sentinel/consumer-api", repositoryId: EXAMPLE_REPOSITORY_ID });
    expect(all.items[0]!.agentResults).toHaveLength(5);

    const latest = ReviewListResponseSchema.parse((await get("/v1/reviews?latest=true", edit)).body);
    expect(latest.items.map((i) => i.pullRequestNumber)).toEqual([4, 5]);
  });

  it("filters by repository and status, and leaves out other organizations", async () => {
    const edit = (seed: StoreSeed) =>
      seed.reviews.push(review(1, 1, { status: "running" }), review(2, 2), review(3, 3, { organizationId: randomUUID() }));

    const running = ReviewListResponseSchema.parse((await get(`/v1/reviews?status=running&repositoryId=${EXAMPLE_REPOSITORY_ID}`, edit)).body);
    expect(running.items.map((i) => i.pullRequestNumber)).toEqual([1]);

    const all = ReviewListResponseSchema.parse((await get("/v1/reviews", edit)).body);
    expect(all.items.map((i) => i.pullRequestNumber)).toEqual([1, 2]);
  });

  it("answers 400 invalid_query for a bad filter", async () => {
    const { status, body } = await get("/v1/reviews?limit=500");
    expect([status, body.code]).toEqual([400, "invalid_query"]);
  });
});

describe("GET /v1/reviews/{reviewId}", () => {
  it("returns the report with where it came from", async () => {
    const r = review(4, 1, { checkConclusion: "fail" });

    const { status, body } = await get(`/v1/reviews/${r.reviewId}`, (seed) => seed.reviews.push(r));

    expect(status).toBe(200);
    expect(ReviewDetailSchema.parse(body)).toMatchObject({
      reviewId: r.reviewId,
      pullRequestNumber: 4,
      pullRequestTitle: "PR 4",
      checkConclusion: "fail",
      findings: exampleCombinedReport.findings,
    });
  });

  it("answers 404 for another organization's review, an unknown id and a malformed one", async () => {
    const theirs = review(4, 1, { organizationId: randomUUID() });
    const edit = (seed: StoreSeed) => seed.reviews.push(theirs);

    for (const id of [theirs.reviewId, randomUUID(), "not-a-uuid"]) {
      const { status, body } = await get(`/v1/reviews/${id}`, edit);
      expect([status, body.code]).toEqual([404, "review_not_found"]);
    }
  });
});
