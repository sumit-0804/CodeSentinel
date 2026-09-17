import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createJsonLogger, loadEnvFile } from "@code-sentinel/service-kit";

import { createAgentClients, loadAgentConfig, type AgentConfig } from "./agents/agent-config.js";
import { createApp, DEFAULT_VERSION } from "./app.js";
import { loadOrchestratorConfig, OrchestratorConfigError, type OrchestratorConfig } from "./config.js";
import { buildReviewGraph } from "./graph/review-graph.js";
import { InMemoryJobStore } from "./jobs/job-store.js";
import { ReviewJobController } from "./jobs/review-job-controller.js";

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? DEFAULT_VERSION;
  } catch {
    return DEFAULT_VERSION;
  }
}

function main(): void {
  const logger = createJsonLogger();

  // The service directory holds `.env` / `.env.production`; `NODE_ENV=production` picks the latter.
  const { env, file } = loadEnvFile(fileURLToPath(new URL("..", import.meta.url)));

  let config: OrchestratorConfig;
  let agentConfig: AgentConfig;
  try {
    config = loadOrchestratorConfig(env);
    agentConfig = loadAgentConfig(env);
  } catch (error) {
    const problems = error instanceof OrchestratorConfigError ? error.problems : [String(error)];
    createJsonLogger(process.stderr).error("invalid orchestrator configuration", { problems });
    process.exitCode = 1;
    return;
  }

  const clients = createAgentClients(agentConfig);
  const { run } = buildReviewGraph({ clients });
  const controller = new ReviewJobController({
    run,
    logger,
    store: new InMemoryJobStore({ retentionMs: config.jobRetentionMs }),
  });
  const app = createApp({
    serviceToken: config.serviceToken,
    logger,
    controller,
    agentsHealth: { clients },
    version: packageVersion(),
  });

  const server = app.listen(config.port, () => {
    logger.info("orchestrator listening", {
      port: config.port,
      agents: Object.keys(clients),
      nodeEnv: env.NODE_ENV,
      envFile: file,
    });
  });

  const shutdown = (signal: string) => {
    logger.info("orchestrator shutting down", { signal });
    server.close();
    server.closeIdleConnections();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main();
