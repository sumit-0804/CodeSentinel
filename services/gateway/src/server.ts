import { readFileSync } from "node:fs";

import { createApp, DEFAULT_VERSION } from "./app.js";
import { GatewayConfigError, loadGatewayConfig, type GatewayConfig } from "./config.js";
import { createJsonLogger } from "./logging/logger.js";
import { OrchestratorClient } from "./orchestrator/orchestrator-client.js";
import { InMemoryStores } from "./persistence/in-memory.js";

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

  let config: GatewayConfig;
  try {
    config = loadGatewayConfig(process.env);
  } catch (error) {
    const problems = error instanceof GatewayConfigError ? error.problems : [String(error)];
    createJsonLogger(process.stderr).error("invalid gateway configuration", { problems });
    process.exitCode = 1;
    return;
  }

  const orchestrator = new OrchestratorClient({
    baseUrl: config.orchestratorUrl,
    serviceToken: config.serviceToken,
    timeoutMs: config.orchestratorTimeoutMs,
  });
  const app = createApp({ config, logger, orchestrator, stores: new InMemoryStores(), version: packageVersion() });
  const server = app.listen(config.port, () => {
    logger.info("gateway listening", { port: config.port, seed: config.seed });
  });

  const shutdown = (signal: string) => {
    logger.info("gateway shutting down", { signal });
    server.close();
    server.closeIdleConnections();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main();
