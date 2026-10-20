import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { AgentKind, ReviewJob, ReviewJobRequest } from "@code-sentinel/contracts";
import { createPrismaClient, type PrismaClient } from "@code-sentinel/db";
import { GeminiEmbedder, LlmConfigError, loadLlmLimits, QuotaBudget, type LlmLimits } from "@code-sentinel/llm";
import { createJsonLogger, loadEnvFile, type Logger } from "@code-sentinel/service-kit";

import { createAgentClients, loadAgentConfig, type AgentConfig } from "./agents/agent-config.js";
import { createApp, DEFAULT_VERSION } from "./app.js";
import { createLlmRouting, type LlmRouting } from "./budget/llm-routing.js";
import { DEFAULT_GROQ_ACCOUNT, loadOrchestratorConfig, OrchestratorConfigError, type OrchestratorConfig } from "./config.js";
import { PgVectorRepository } from "./context/pgvector-repository.js";
import { SimilarIssueLookup } from "./context/similar-issue-lookup.js";
import { DEFAULT_CONFIDENCE_THRESHOLD } from "./graph/defaults.js";
import { buildReviewGraph } from "./graph/review-graph.js";
import { InMemoryJobStore, type JobStore } from "./jobs/job-store.js";
import { PrismaJobStore } from "./jobs/prisma-job-store.js";
import { ReviewJobController, type RunReview } from "./jobs/review-job-controller.js";
import { createOrchestratorMetrics, type OrchestratorMetrics, type WatchedBudget } from "./metrics.js";

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? DEFAULT_VERSION;
  } catch {
    return DEFAULT_VERSION;
  }
}

/** pgvector + Gemini embeddings, on their own quota budget; undefined when embeddings aren't configured. */
function createSimilarIssueLookup(
  prisma: PrismaClient,
  limits: LlmLimits,
  config: OrchestratorConfig,
  budget: QuotaBudget | undefined,
  metrics: OrchestratorMetrics,
): SimilarIssueLookup | undefined {
  if (!limits.embedding || !budget) return undefined;
  const embedder = new GeminiEmbedder({ apiKey: limits.embedding.apiKey, model: limits.embedding.model, budget });
  const vectors = new PgVectorRepository(prisma, {
    embedder,
    embeddingModel: limits.embedding.model,
    minSimilarity: config.context.minSimilarity,
  });
  return new SimilarIssueLookup(vectors, {
    maxFindings: config.context.maxFindings,
    timeoutMs: config.context.timeoutMs,
    onLookup: (outcome) => metrics.recordLookup(outcome),
  });
}

/** Stores the finished review's vectors once its `findings` rows exist, so later reviews can find them. */
function indexFindings(lookup: SimilarIssueLookup, logger: Logger) {
  return async (job: ReviewJob, request: ReviewJobRequest): Promise<void> => {
    if (!job.report || !request.includeSimilarPastIssues) return;
    const failed = await lookup.index(job.report.findings, {
      organizationId: request.organizationId,
      confidenceThreshold: job.report.confidenceThreshold ?? request.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
    });
    if (failed > 0) logger.warn("some findings were not indexed for similar-issue search", { reviewId: job.reviewId, failed });
  };
}

/** Every quota budget in use, once each: Gemini, each Groq account, and the embedding key. */
function watchedBudgets(routing: LlmRouting | undefined, accounts: OrchestratorConfig["groqAccounts"], embedding: QuotaBudget | undefined): WatchedBudget[] {
  const watched: WatchedBudget[] = [];
  const seen = new Set<QuotaBudget>();
  const add = (provider: string, account: string, budget: QuotaBudget | undefined) => {
    if (!budget || seen.has(budget)) return;
    seen.add(budget);
    watched.push({ provider, account, budget });
  };
  add("groq", DEFAULT_GROQ_ACCOUNT, routing?.budgets.groq);
  for (const [agent, budget] of Object.entries(routing?.groqByAgent ?? {})) add("groq", accounts[agent as AgentKind] ?? agent, budget);
  add("gemini", "default", routing?.budgets.gemini);
  add("gemini_embedding", "default", embedding);
  return watched;
}

async function main(): Promise<void> {
  const logger = createJsonLogger();

  // The service directory holds `.env` / `.env.production`; `NODE_ENV=production` picks the latter.
  const { env, file } = loadEnvFile(fileURLToPath(new URL("..", import.meta.url)));

  let config: OrchestratorConfig;
  let agentConfig: AgentConfig;
  let llmLimits: LlmLimits;
  try {
    config = loadOrchestratorConfig(env);
    agentConfig = loadAgentConfig(env);
    llmLimits = loadLlmLimits(env);
  } catch (error) {
    const problems =
      error instanceof OrchestratorConfigError || error instanceof LlmConfigError ? error.problems : [String(error)];
    createJsonLogger(process.stderr).error("invalid orchestrator configuration", { problems });
    process.exitCode = 1;
    return;
  }

  const clients = createAgentClients(agentConfig);
  // One Gemini budget and one Groq budget per Groq account, shared by every review.
  const llmRouting = createLlmRouting(llmLimits, config.llmAgentTimeoutMs, config.groqAccounts);
  if (!llmRouting) logger.warn("no LLM provider configured; LLM agents run their rule-based checks only");

  let prisma: PrismaClient | undefined;
  let store: JobStore;
  if (config.databaseUrl) {
    prisma = createPrismaClient(config.databaseUrl);
    try {
      // Fail at startup, not on the first review, when the URL or the password is wrong.
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      createJsonLogger(process.stderr).error("cannot reach the database", { error: (error as Error).message });
      await prisma.$disconnect();
      process.exitCode = 1;
      return;
    }
    const prismaStore = new PrismaJobStore(prisma, llmRouting ? { llmAgentTimeoutMs: config.llmAgentTimeoutMs } : {});
    // One orchestrator instance: whatever a previous process left queued or running can never finish.
    const orphaned = await prismaStore.failOrphaned(new Date().toISOString());
    if (orphaned > 0) logger.warn("failed review jobs left running by a previous process", { orphaned });
    store = prismaStore;
  } else {
    store = new InMemoryJobStore({ retentionMs: config.jobRetentionMs });
  }

  const embeddingBudget = llmLimits.embedding ? new QuotaBudget(llmLimits.embedding.limits, { headroom: llmLimits.headroom }) : undefined;
  const metrics = createOrchestratorMetrics(watchedBudgets(llmRouting, config.groqAccounts, embeddingBudget));
  const similarIssueLookup = prisma ? createSimilarIssueLookup(prisma, llmLimits, config, embeddingBudget, metrics) : undefined;
  if (!similarIssueLookup) logger.warn("vector context off: needs DATABASE_URL, GEMINI_API_KEY and GEMINI_EMBED_RPM/TPM/RPD");
  const graph = buildReviewGraph({
    clients,
    agentWakeMs: config.agentWakeMs,
    ...(llmRouting ? { llmRouting } : {}),
    ...(similarIssueLookup ? { similarIssueLookup } : {}),
  });
  const run: RunReview = async (input, options) => {
    const report = await graph.run(input, options);
    metrics.recordReport(report);
    return report;
  };

  const controller = new ReviewJobController({
    run,
    logger,
    store,
    ...(similarIssueLookup ? { afterComplete: indexFindings(similarIssueLookup, logger) } : {}),
  });
  const database = prisma;
  const app = createApp({
    serviceToken: config.serviceToken,
    logger,
    controller,
    agentsHealth: { clients },
    ...(database ? { database: { ping: () => database.$queryRaw`SELECT 1` } } : {}),
    version: packageVersion(),
    metrics,
    ...(config.metricsToken ? { metricsToken: config.metricsToken } : {}),
  });

  const server = app.listen(config.port, () => {
    logger.info("orchestrator listening", {
      port: config.port,
      stores: prisma ? "postgres" : "memory",
      agents: Object.keys(clients),
      llmProviders: Object.keys(llmRouting?.budgets ?? {}),
      vectorContext: similarIssueLookup !== undefined,
      nodeEnv: env.NODE_ENV,
      envFile: file,
    });
  });

  const shutdown = (signal: string) => {
    logger.info("orchestrator shutting down", { signal });
    server.close(() => void prisma?.$disconnect());
    server.closeIdleConnections();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

await main();
