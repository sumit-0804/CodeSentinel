import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createJsonLogger, loadEnvFile } from "@code-sentinel/service-kit";

import { createApp, DEFAULT_VERSION } from "./app.js";
import { GatewayConfigError, loadGatewayConfig, type GatewayConfig } from "./config.js";
import type { GitHubClient } from "./github/github-client.js";
import { OctokitGitHubClient } from "./github/octokit-github-client.js";
import { StubGitHubClient } from "./github/stub-github-client.js";
import { OrchestratorClient } from "./orchestrator/orchestrator-client.js";
import { devSeed } from "./persistence/dev-seed.js";
import { emptySeed, InMemoryStores } from "./persistence/in-memory.js";

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
  const serviceDir = fileURLToPath(new URL("..", import.meta.url));
  const { env, file } = loadEnvFile(serviceDir);

  let config: GatewayConfig;
  try {
    config = loadGatewayConfig(env);
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
  // Until PostgreSQL lands, `none` starts with empty stores; `dev` seeds one repository and user.
  const { seed, pullRequestFiles } =
    config.seed === "dev"
      ? devSeed(config.devRepository ? { repository: config.devRepository } : {})
      : { seed: emptySeed(), pullRequestFiles: [] };

  let github: GitHubClient;
  if (config.githubApp) {
    const keyPath = resolve(serviceDir, config.githubApp.privateKeyPath);
    try {
      github = new OctokitGitHubClient({ appId: config.githubApp.appId, privateKey: readFileSync(keyPath, "utf8") });
    } catch (error) {
      createJsonLogger(process.stderr).error("cannot read the GitHub App private key", { keyPath, error });
      process.exitCode = 1;
      return;
    }
  } else {
    github = new StubGitHubClient(pullRequestFiles);
  }

  const app = createApp({
    config,
    logger,
    orchestrator,
    github,
    stores: new InMemoryStores(seed),
    version: packageVersion(),
  });
  const server = app.listen(config.port, () => {
    logger.info("gateway listening", {
      port: config.port,
      seed: config.seed,
      github: config.githubApp ? `app ${config.githubApp.appId}` : "stub",
      ...(config.devRepository ? { devRepository: config.devRepository.fullName } : {}),
      nodeEnv: env.NODE_ENV,
      envFile: file,
    });
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
