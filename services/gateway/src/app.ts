import {
  errorHandler,
  notFoundHandler,
  requestIdMiddleware,
  requestLoggerMiddleware,
  type Logger,
} from "@code-sentinel/service-kit";
import express, { type Express } from "express";
import helmet from "helmet";

import { createAuthMiddleware } from "./auth/authenticate.js";
import { createGatewayMetrics } from "./http/metrics.js";
import { createRateLimits, DEFAULT_RATE_LIMITS } from "./http/rate-limits.js";
import { createSupabaseTokenVerifier, type SupabaseTokenVerifier } from "./auth/supabase-token.js";
import type { GatewayConfig } from "./config.js";
import type { GitHubClient } from "./github/github-client.js";
import type { ReviewPublisher } from "./github/review-publisher.js";
import type { OrchestratorClientLike } from "./orchestrator/orchestrator-client.js";
import type { Stores } from "./persistence/stores.js";
import { createHealthzRouter, type DatabaseHealth } from "./routes/healthz.js";
import { createGithubRouter } from "./routes/github.js";
import { createMeRouter } from "./routes/me.js";
import { createOrganizationsRouter } from "./routes/organizations.js";
import { createRepositoriesRouter } from "./routes/repositories.js";
import { createFindingsRouter } from "./routes/findings.js";
import { createPullRequestsRouter } from "./routes/pull-requests.js";
import { createReviewsRouter } from "./routes/reviews.js";
import type { GitHubUserClient } from "./github/github-user-client.js";
import type { InstallationSync } from "./github/installation-sync.js";
import { createGithubWebhookRouter } from "./webhooks/github-webhook.js";

export const DEFAULT_VERSION = "0.0.0";

/** Everything the app talks to, injected so tests pass fakes and in-memory stores. */
export interface AppDeps {
  config: GatewayConfig;
  logger: Logger;
  orchestrator: OrchestratorClientLike;
  github: GitHubClient;
  stores: Stores;
  /** Pinged by `/healthz` when the stores are in Postgres. */
  database?: DatabaseHealth;
  /** Reported by `/healthz`. */
  version?: string;
  /** Clock for sign-in records, step-up checks and review timestamps. */
  now?: () => Date;
  /** Overrides the JWKS-backed verifier built from `config.supabaseUrl` (tests use a local key). */
  supabaseVerifier?: SupabaseTokenVerifier;
  /** GitHub linking and installation sync; absent when `config.githubLink` is not set (routes answer 503). */
  githubLink?: { githubUsers: GitHubUserClient; sync: InstallationSync };
  /** Posts finished reviews to GitHub; without it reviews run but nothing is posted. */
  publisher?: Pick<ReviewPublisher, "follow" | "nothingToReview">;
}

/**
 * The gateway's single Express entry point (FR-GW-01). Body parsers are mounted per route, never
 * globally, so the webhook route receives the exact bytes GitHub signed (FR-GW-03).
 */
export function createApp(deps: AppDeps): Express {
  const { config, logger, orchestrator, github, stores, database, version = DEFAULT_VERSION, now, publisher, supabaseVerifier, githubLink } = deps;
  const app = express();
  const metrics = createGatewayMetrics();
  const limits = createRateLimits(config.rateLimits ?? DEFAULT_RATE_LIMITS, (limiter) => metrics.rateLimited.inc({ limiter }));

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy ?? 0);
  app.use(metrics.httpMiddleware);
  app.use(requestIdMiddleware());
  app.use(requestLoggerMiddleware(logger));
  app.use(helmet());
  app.use(metrics.router(config.metricsToken));
  app.use("/webhooks/github", metrics.webhookOutcomes);

  app.use(createHealthzRouter({ orchestrator, version, ...(database ? { database } : {}) }));
  app.use(
    createGithubWebhookRouter({
      secret: config.githubWebhookSecret,
      stores,
      github,
      orchestrator,
      logger,
      fileContentMaxBytes: config.fileContentMaxBytes,
      rateLimit: limits.webhook,
      ...(config.dashboardUrl ? { dashboardUrl: config.dashboardUrl } : {}),
      ...(publisher ? { publisher } : {}),
      ...(now ? { now } : {}),
    }),
  );

  const v1 = express.Router();
  v1.use(express.json({ limit: "1mb" }));
  // Before authentication, so an IP guessing tokens is stopped without verifying each one.
  v1.use(limits.failedAuth);
  const supabase = supabaseVerifier ?? (config.supabaseUrl ? createSupabaseTokenVerifier({ supabaseUrl: config.supabaseUrl }) : undefined);
  v1.use(
    createAuthMiddleware({
      sessions: stores.sessions,
      users: stores.users,
      logger,
      ...(supabase ? { supabase } : {}),
      ...(now ? { now } : {}),
    }),
  );
  v1.use(limits.user, limits.write);
  const stepUp ={ minutes: config.mfaStepUpMinutes, now: now ?? (() => new Date()) };
  v1.use(createMeRouter({ users: stores.users }));
  v1.use(createGithubRouter({ users: stores.users, installations: stores.installations, logger, stepUp, ...(githubLink ? { link: githubLink } : {}) }));
  v1.use(createRepositoriesRouter({ repositories: stores.repositories, repositoryConfig: stores.repositoryConfig, users: stores.users, stepUp }));
  v1.use(createOrganizationsRouter({ repositoryConfig: stores.repositoryConfig, users: stores.users, stepUp }));
  v1.use(createReviewsRouter({ reviews: stores.reviews, suggestions: stores.suggestions }));
  v1.use(createFindingsRouter({ stores, github, logger, stepUp, ...(config.dashboardUrl ? { dashboardUrl: config.dashboardUrl } : {}) }));
  v1.use(createPullRequestsRouter({ stores, github, orchestrator, logger, fileContentMaxBytes: config.fileContentMaxBytes, ...(publisher ? { publisher } : {}), ...(now ? { now } : {}) }));
  app.use("/v1", v1);

  app.use(notFoundHandler());
  app.use(errorHandler(logger));
  return app;
}
