import { ReviewJobRequestSchema } from "@code-sentinel/contracts";
import { badRequest, notFound, type ServiceResponse } from "@code-sentinel/service-kit";
import express, { Router, type Request } from "express";

import type { ReviewJobController } from "../jobs/review-job-controller.js";

/** Same shape the kit accepts for `X-Request-Id`: visible ASCII, bounded length. */
const VALID_IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,200}$/;

export interface ReviewJobsRouterDeps {
  controller: Pick<ReviewJobController, "createJob" | "getJob" | "cancelJob">;
}

/** `/review-jobs` from `orchestrator.yaml`; mounted under `/internal/v1` behind the service token. */
export function createReviewJobsRouter({ controller }: ReviewJobsRouterDeps): Router {
  const router = Router();

  // A whole pull request's patches travel in one body.
  router.post("/review-jobs", express.json({ limit: "10mb" }), (req: Request, res: ServiceResponse) => {
    const idempotencyKey = req.get("idempotency-key");
    if (idempotencyKey !== undefined && !VALID_IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw badRequest("invalid_header", "Idempotency-Key must be 1..200 visible ASCII characters");
    }

    const request = ReviewJobRequestSchema.parse(req.body);
    const { job, created } = controller.createJob(request, {
      requestId: res.locals.requestId,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
    res.locals.logFields = { jobId: job.jobId, reviewId: job.reviewId, created };
    res.status(created ? 202 : 200).json(job);
  });

  router.get("/review-jobs/:jobId", (req: Request<{ jobId: string }>, res: ServiceResponse) => {
    res.json(found(controller.getJob(req.params.jobId), req.params.jobId));
  });

  router.post("/review-jobs/:jobId/cancel", (req: Request<{ jobId: string }>, res: ServiceResponse) => {
    const job = found(controller.cancelJob(req.params.jobId), req.params.jobId);
    res.locals.logFields = { jobId: job.jobId, status: job.status };
    res.json(job);
  });

  return router;
}

function found<T>(job: T | undefined, jobId: string): T {
  if (job === undefined) throw notFound("not_found", `Review job ${jobId} not found`);
  return job;
}
