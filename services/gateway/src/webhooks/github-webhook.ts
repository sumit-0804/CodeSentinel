import type { WebhookAccepted } from "@code-sentinel/contracts";
import express, { Router, type Request } from "express";

import type { GatewayResponse } from "../auth/principal.js";
import { badRequest } from "../http/errors.js";
import { createSignatureMiddleware } from "./signature.js";

export interface GithubWebhookRouterDeps {
  secret: string;
}

/** `POST /webhooks/github`: raw body, signature check, then the decision tree from `seq_uc1_pr_review.mmd`. */
export function createGithubWebhookRouter({ secret }: GithubWebhookRouterDeps): Router {
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

      if (!event || !deliveryId) {
        logFields.outcome = "missing_header";
        throw badRequest("missing_header", "X-GitHub-Event and X-GitHub-Delivery are required");
      }

      try {
        JSON.parse((req.body as Buffer).toString("utf8"));
      } catch {
        logFields.outcome = "invalid_payload";
        throw badRequest("invalid_payload", "Webhook body is not valid JSON");
      }

      logFields.outcome = "event_ignored";
      const body: WebhookAccepted = { accepted: true, action: "event_ignored" };
      res.status(202).json(body);
    },
  );

  return router;
}
