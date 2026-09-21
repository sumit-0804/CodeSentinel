import { createJsonLogger, loadEnvFile } from "@code-sentinel/service-kit";

import type { ReviewAgent } from "./agent.js";
import { createAgentService } from "./app.js";
import { AgentConfigError, loadAgentEnv, type AgentEnv } from "./config.js";

export interface StartOptions {
  /** Port from `agent.yaml` (security 8081, style 8082, …), used when `PORT` is unset. */
  defaultPort: number;
  /** The service directory holding `.env` / `.env.production`. */
  serviceDir: string;
}

/** The `server.ts` of every agent service: load env, build the app, listen, shut down on signals. */
export function startAgentService(agent: ReviewAgent, options: StartOptions): void {
  const logger = createJsonLogger(process.stdout, { agent: agent.kind });
  const { env, file } = loadEnvFile(options.serviceDir);

  let config: AgentEnv;
  try {
    config = loadAgentEnv(env, { defaultPort: options.defaultPort, usesLlm: agent.usesLlm });
  } catch (error) {
    const problems = error instanceof AgentConfigError ? error.problems : [String(error)];
    createJsonLogger(process.stderr, { agent: agent.kind }).error("invalid agent configuration", { problems });
    process.exitCode = 1;
    return;
  }
  if (agent.usesLlm && !config.llm) logger.warn("no LLM provider configured; running rule-based checks only");

  const app = createAgentService({ agent, serviceToken: config.serviceToken, logger, ...(config.llm ? { llm: config.llm } : {}) });
  const server = app.listen(config.port, () => {
    logger.info("agent listening", {
      port: config.port,
      version: agent.version,
      llmProviders: (["groq", "gemini"] as const).filter((provider) => config.llm?.has(provider)),
      nodeEnv: env.NODE_ENV,
      envFile: file,
    });
  });

  const shutdown = (signal: string) => {
    logger.info("agent shutting down", { signal });
    server.close();
    server.closeIdleConnections();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
