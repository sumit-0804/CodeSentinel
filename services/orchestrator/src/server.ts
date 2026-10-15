import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createPrismaClient, type PrismaClient } from "@code-sentinel/db";
import { LlmConfigError, loadLlmLimits, type LlmLimits } from "@code-sentinel/llm";
import { createJsonLogger, loadEnvFile } from "@code-sentinel/service-kit";

import { createAgentClients, loadAgentConfig, type AgentConfig } from "./agents/agent-config.js";
import { createApp, DEFAULT_VERSION } from "./app.js";
import { createLlmRouting } from "./budget/llm-routing.js";
import { loadOrchestratorConfig, OrchestratorConfigError, type OrchestratorConfig } from "./config.js";
import { buildReviewGraph } from "./graph/review-graph.js";
import { InMemoryJobStore, type JobStore } from "./jobs/job-store.js";
import { PrismaJobStore } from "./jobs/prisma-job-store.js";
import { ReviewJobController } from "./jobs/review-job-controller.js";

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? DEFAULT_VERSION;
  } catch {
    return DEFAULT_VERSION;
  }
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
  const { run } = buildReviewGraph({ clients, ...(llmRouting ? { llmRouting } : {}) });

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

  const controller = new ReviewJobController({ run, logger, store });
  const database = prisma;
  const app = createApp({
    serviceToken: config.serviceToken,
    logger,
    controller,
    agentsHealth: { clients },
    ...(database ? { database: { ping: () => database.$queryRaw`SELECT 1` } } : {}),
    version: packageVersion(),
  });

  const server = app.listen(config.port, () => {
    logger.info("orchestrator listening", {
      port: config.port,
      stores: prisma ? "postgres" : "memory",
      agents: Object.keys(clients),
      llmProviders: Object.keys(llmRouting?.budgets ?? {}),
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
