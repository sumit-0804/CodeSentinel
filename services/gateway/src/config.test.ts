import { describe, expect, it } from "vitest";

import { GatewayConfigError, loadGatewayConfig } from "./config.js";

const FULL_ENV = {
  PORT: "8443",
  ORCHESTRATOR_URL: "http://orchestrator.internal:8080",
  ORCHESTRATOR_TIMEOUT_MS: "7000",
  SERVICE_TOKEN: "service-token",
  JWT_SECRET: "0123456789abcdef0123456789abcdef",
  GITHUB_WEBHOOK_SECRET: "webhook-secret-16",
  GATEWAY_SEED: "dev",
};

function configError(env: Record<string, string | undefined>): GatewayConfigError {
  try {
    loadGatewayConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(GatewayConfigError);
    return error as GatewayConfigError;
  }
  throw new Error("expected loadGatewayConfig to throw");
}

describe("loadGatewayConfig", () => {
  it("loads a full environment", () => {
    expect(loadGatewayConfig(FULL_ENV)).toEqual({
      port: 8443,
      orchestratorUrl: "http://orchestrator.internal:8080",
      orchestratorTimeoutMs: 7000,
      serviceToken: "service-token",
      jwtSecret: "0123456789abcdef0123456789abcdef",
      githubWebhookSecret: "webhook-secret-16",
      seed: "dev",
    });
  });

  it("defaults PORT, ORCHESTRATOR_TIMEOUT_MS and GATEWAY_SEED", () => {
    const config = loadGatewayConfig({ ...FULL_ENV, PORT: undefined, ORCHESTRATOR_TIMEOUT_MS: "", GATEWAY_SEED: undefined });

    expect(config.port).toBe(3000);
    expect(config.orchestratorTimeoutMs).toBe(5000);
    expect(config.seed).toBe("none");
  });

  it("names a missing GITHUB_WEBHOOK_SECRET", () => {
    const error = configError({ ...FULL_ENV, GITHUB_WEBHOOK_SECRET: undefined });

    expect(error.message).toContain("GITHUB_WEBHOOK_SECRET is required");
  });

  it("rejects a JWT_SECRET shorter than 32 characters", () => {
    const error = configError({ ...FULL_ENV, JWT_SECRET: "too-short" });

    expect(error.message).toContain("JWT_SECRET must be at least 32 characters");
  });

  it("rejects an ORCHESTRATOR_URL that is not http or https", () => {
    const error = configError({ ...FULL_ENV, ORCHESTRATOR_URL: "ftp://orchestrator.internal" });

    expect(error.message).toContain("ORCHESTRATOR_URL must be an http or https URL");
  });

  it("rejects a non-numeric PORT", () => {
    const error = configError({ ...FULL_ENV, PORT: "abc" });

    expect(error.message).toContain("PORT");
  });

  it("refuses the dev seed when NODE_ENV is production", () => {
    const error = configError({ ...FULL_ENV, NODE_ENV: "production", GATEWAY_SEED: "dev" });

    expect(error.message).toContain("GATEWAY_SEED must be none when NODE_ENV is production");
  });

  it("names every problem in one error", () => {
    const error = configError({ ...FULL_ENV, SERVICE_TOKEN: "", JWT_SECRET: "short", PORT: "70000" });

    expect(error.problems).toHaveLength(3);
    expect(error.message).toContain("SERVICE_TOKEN is required");
    expect(error.message).toContain("JWT_SECRET");
    expect(error.message).toContain("PORT must be between 1 and 65535");
  });
});
