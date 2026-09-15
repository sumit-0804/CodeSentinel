import type { GatewayConfig } from "../config.js";
import { createJsonLogger, type Logger } from "../logging/logger.js";

/** A valid `GatewayConfig` with dummy secrets. Never a real secret, never port 3000. */
export function testConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    port: 0,
    orchestratorUrl: "http://orchestrator.test:8080",
    orchestratorTimeoutMs: 1000,
    serviceToken: "test-service-token",
    jwtSecret: "test-jwt-secret-0123456789abcdef-0123",
    githubWebhookSecret: "test-webhook-secret",
    seed: "none",
    ...overrides,
  };
}

/** A real JSON logger whose lines are captured and parsed, for tests that assert on logging. */
export function captureLogger(): { logger: Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const logger = createJsonLogger({
    write: (chunk: string) => lines.push(JSON.parse(chunk) as Record<string, unknown>),
  });
  return { logger, lines };
}
