import { ReviewListQuerySchema, type ReviewDetail, type ReviewListResponse } from "@code-sentinel/contracts";
import { badRequest, notFound } from "@code-sentinel/service-kit";
import { Router, type Request } from "express";
import { z } from "zod";

import { requireOrganization } from "../auth/guards.js";
import type { GatewayResponse } from "../auth/principal.js";
import type { ReviewStore } from "../persistence/stores.js";
import { toDetail, toListItem } from "./review-view.js";

const ReviewIdSchema = z.string().uuid();

/** Review history (FR-WEB-01, FR-WEB-04): `GET /v1/reviews` and `GET /v1/reviews/{id}`, scoped to the caller's organization. */
export function createReviewsRouter({ reviews }: { reviews: ReviewStore }): Router {
  const router = Router();

  router.get("/reviews", requireOrganization, async (req: Request, res: GatewayResponse) => {
    const query = ReviewListQuerySchema.safeParse(req.query);
    if (!query.success) throw badRequest("invalid_query", "The review filters are not valid", { issues: query.error.issues });
    const { repositoryId, status, latest = false, limit, offset } = query.data;

    const { rows, total } = await reviews.list(res.locals.principal!.organizationId!, {
      ...(repositoryId ? { repositoryId } : {}),
      ...(status ? { status } : {}),
      latest,
      limit,
      offset,
    });
    const body: ReviewListResponse = { items: rows.map(toListItem), pageInfo: { total, limit, offset } };
    res.json(body);
  });

  router.get("/reviews/:reviewId", requireOrganization, async (req: Request<{ reviewId: string }>, res: GatewayResponse) => {
    // A malformed id is answered like an unknown one.
    const id = ReviewIdSchema.safeParse(req.params.reviewId);
    const record = id.success ? await reviews.get(res.locals.principal!.organizationId!, id.data) : undefined;
    if (!record) throw notFound("review_not_found", "No such review in this organization");
    const body: ReviewDetail = toDetail(record);
    res.json(body);
  });

  return router;
}
