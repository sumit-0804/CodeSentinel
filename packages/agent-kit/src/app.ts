import { AgentReviewRequestSchema, type Capabilities, type Health, type HealthStatus } from "@code-sentinel/contracts";
import { LlmUnavailableError, type LlmClient } from "@code-sentinel/llm";
import {
  errorHandler,
  HttpError,
  notFoundHandler,
  requestIdMiddleware,
  requestLoggerMiddleware,
  serviceAuthMiddleware,
  type Logger,
  type ServiceResponse,
} from "@code-sentinel/service-kit";
import express, { type Express, type Request } from "express";
import helmet from "helmet";

import type { ReviewAgent } from "./agent.js";
import { runReview } from "./review.js";

export interface AgentServiceDeps {
  agent: ReviewAgent;
  serviceToken: string;
  logger: Logger;
  /** Absent when no LLM key is set; LLM agents then run their rule-based checks only. */
  llm?: LlmClient;
}

/** One agent service speaking `docs/design/openapi/agent.yaml` (FR-SEC-04, NFR-10). */
export function createAgentService({ agent, serviceToken, logger, llm }: AgentServiceDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestIdMiddleware());
  app.use(requestLoggerMiddleware(logger));
  app.use(helmet());

  app.get("/healthz", async (_req, res) => {
    const health = await checkHealth(agent, llm);
    res.status(health.status === "unavailable" ? 503 : 200).json(health);
  });

  app.get("/v1/capabilities", (_req, res) => {
    const body: Capabilities = {
      agent: agent.kind,
      version: agent.version,
      languages: agent.languages,
      usesLlm: agent.usesLlm,
      producesDeterministicFixes: agent.producesDeterministicFixes ?? false,
      maxDiffBytes: agent.maxDiffBytes,
      maxFileTokens: agent.maxFileTokens,
      ...(agent.rules ? { rules: agent.rules } : {}),
    };
    res.json(body);
  });

  app.post(
    "/v1/review",
    serviceAuthMiddleware(serviceToken),
    express.json({ limit: agent.maxDiffBytes }),
    async (req: Request, res: ServiceResponse) => {
      const request = AgentReviewRequestSchema.parse(req.body);
      // The orchestrator abandons the call at its timeout; stop working when it hangs up.
      const hangUp = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) hangUp.abort();
      });

      try {
        const response = await runReview(agent, request, {
          requestId: res.locals.requestId,
          logger: logger.child({ requestId: res.locals.requestId, reviewId: request.reviewId }),
          signal: hangUp.signal,
          ...(llm ? { llm } : {}),
        });
        res.locals.logFields = {
          reviewId: request.reviewId,
          files: request.files.length,
          findings: response.findings.length,
          ...(response.llm?.provider ? { llmProvider: response.llm.provider } : {}),
        };
        res.json(response);
      } catch (error) {
        if (error instanceof LlmUnavailableError) {
          throw new HttpError(503, "llm_unavailable", `LLM provider ${error.provider} is not configured on this agent`);
        }
        throw error;
      }
    },
  );

  app.use(notFoundHandler());
  app.use(errorHandler(logger));
  return app;
}

async function checkHealth(agent: ReviewAgent, llm: LlmClient | undefined): Promise<Health> {
  let checks: Record<string, HealthStatus>;
  try {
    checks = { ...(await agent.health?.()) };
  } catch {
    checks = { agent: "unavailable" };
  }
  // Without a key an LLM agent still answers with its rule-based checks, so it is degraded, not down.
  if (agent.usesLlm) checks.llmProvider = llm ? "ok" : "degraded";

  const values = Object.values(checks);
  const status: HealthStatus = values.includes("unavailable") ? "unavailable" : values.includes("degraded") ? "degraded" : "ok";
  return { status, version: agent.version, ...(values.length ? { checks } : {}) };
}
