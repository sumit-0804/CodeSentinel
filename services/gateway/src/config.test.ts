import { describe, expect, it } from "vitest";

import { GatewayConfigError, loadGatewayConfig } from "./config.js";

const FULL_ENV = {
  PORT: "8443",
  ORCHESTRATOR_URL: "http://orchestrator.internal:8080",
  ORCHESTRATOR_TIMEOUT_MS: "7000",
  SERVICE_TOKEN: "service-token",
  GITHUB_WEBHOOK_SECRET: "webhook-secret-16",
  GATEWAY_SEED: "dev",
};

// Dummy values: a fake client id and secret, and 32 zero bytes as the key.
const GITHUB_LINK_ENV = {
  GITHUB_APP_CLIENT_ID: "Iv23liTestClientId",
  GITHUB_APP_CLIENT_SECRET: "0123456789abcdef0123456789abcdef01234567",
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
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
      githubWebhookSecret: "webhook-secret-16",
      seed: "dev",
      reviewPollTimeoutMs: 300_000,
      mfaStepUpMinutes: 10,
    });
  });

  it("reads MFA_STEP_UP_MINUTES and rejects values outside 1–60", () => {
    expect(loadGatewayConfig({ ...FULL_ENV, MFA_STEP_UP_MINUTES: "5" }).mfaStepUpMinutes).toBe(5);
    expect(configError({ ...FULL_ENV, MFA_STEP_UP_MINUTES: "0" }).problems).toEqual(["MFA_STEP_UP_MINUTES must be between 1 and 60"]);
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

  it("reads SUPABASE_URL without a trailing slash and rejects a non-http value", () => {
    expect(loadGatewayConfig({ ...FULL_ENV, SUPABASE_URL: "https://ref.supabase.co/" }).supabaseUrl).toBe("https://ref.supabase.co");
    expect(loadGatewayConfig(FULL_ENV).supabaseUrl).toBeUndefined();
    expect(configError({ ...FULL_ENV, SUPABASE_URL: "ref.supabase.co" }).message).toContain("SUPABASE_URL must be an http or https URL");
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
    const error = configError({ ...FULL_ENV, SERVICE_TOKEN: "", SUPABASE_URL: "nope", PORT: "70000" });

    expect(error.problems).toHaveLength(3);
    expect(error.message).toContain("SERVICE_TOKEN is required");
    expect(error.message).toContain("SUPABASE_URL");
    expect(error.message).toContain("PORT must be between 1 and 65535");
  });
  it("reads the GitHub App settings and the dev repository override", () => {
    const config = loadGatewayConfig({
      ...FULL_ENV,
      GITHUB_APP_ID: "12345",
      GITHUB_PRIVATE_KEY_PATH: "github-app.pem",
      GATEWAY_DEV_REPOSITORY: "sumit-0804/code-sentinel-playground:1390792507",
    });

    expect(config.githubApp).toEqual({ appId: 12345, privateKeyPath: "github-app.pem" });
    expect(config.devRepository).toEqual({ fullName: "sumit-0804/code-sentinel-playground", githubRepoId: 1390792507 });
  });

  it("requires the GitHub App id and key together, and both in production", () => {
    expect(configError({ ...FULL_ENV, GITHUB_APP_ID: "12345" }).message).toContain("GITHUB_APP_ID must be set together with GITHUB_PRIVATE_KEY_PATH");
    expect(configError({ ...FULL_ENV, GATEWAY_SEED: "none", NODE_ENV: "production" }).message).toContain(
      "GITHUB_APP_ID is required when NODE_ENV is production",
    );
    expect(configError({ ...FULL_ENV, GATEWAY_DEV_REPOSITORY: "no-id" }).message).toContain("must look like owner/name:githubRepoId");
  });

  describe("DATABASE_URL", () => {
    const DB_URL = "postgresql://prisma.ref:secret@aws-0-ap-south-1.pooler.supabase.com:5432/postgres";

    it("is optional and read when set", () => {
      expect(loadGatewayConfig(FULL_ENV).databaseUrl).toBeUndefined();
      expect(loadGatewayConfig({ ...FULL_ENV, GATEWAY_SEED: "none", DATABASE_URL: DB_URL }).databaseUrl).toBe(DB_URL);
    });

    it("rejects a URL that is not postgres, without echoing it", () => {
      const error = configError({ ...FULL_ENV, GATEWAY_SEED: "none", DATABASE_URL: "mysql://user:secret@db/x" });

      expect(error.message).toContain("DATABASE_URL must be a postgres:// or postgresql:// URL");
      expect(error.message).not.toContain("secret");
    });

    it("refuses the dev seed alongside a database", () => {
      expect(configError({ ...FULL_ENV, DATABASE_URL: DB_URL }).message).toContain("GATEWAY_SEED must be none when DATABASE_URL is set");
    });

    it("is required in production", () => {
      const error = configError({
        ...FULL_ENV,
        GATEWAY_SEED: "none",
        NODE_ENV: "production",
        GITHUB_APP_ID: "1",
        GITHUB_PRIVATE_KEY_PATH: "k.pem",
        ...GITHUB_LINK_ENV,
        SUPABASE_URL: "https://ref.supabase.co",
      });

      expect(error.problems).toEqual(["DATABASE_URL is required when NODE_ENV is production"]);
    });
  });

  it("requires SUPABASE_URL in production", () => {
    const error = configError({
      ...FULL_ENV,
      GATEWAY_SEED: "none",
      NODE_ENV: "production",
      GITHUB_APP_ID: "1",
      GITHUB_PRIVATE_KEY_PATH: "k.pem",
      ...GITHUB_LINK_ENV,
      DATABASE_URL: "postgresql://u:p@db.example:5432/postgres",
    });

    expect(error.problems).toEqual(["SUPABASE_URL is required when NODE_ENV is production"]);
  });

  describe("GitHub linking", () => {
    it("reads the three settings together", () => {
      expect(loadGatewayConfig({ ...FULL_ENV, ...GITHUB_LINK_ENV }).githubLink).toEqual({
        clientId: GITHUB_LINK_ENV.GITHUB_APP_CLIENT_ID,
        clientSecret: GITHUB_LINK_ENV.GITHUB_APP_CLIENT_SECRET,
        fieldEncryptionKey: GITHUB_LINK_ENV.FIELD_ENCRYPTION_KEY,
      });
      expect(loadGatewayConfig(FULL_ENV).githubLink).toBeUndefined();
    });

    it("refuses a partial set and a key that is not 32 bytes", () => {
      expect(configError({ ...FULL_ENV, GITHUB_APP_CLIENT_ID: "Iv23abc" }).message).toContain(
        "GITHUB_APP_CLIENT_ID must be set together with GITHUB_APP_CLIENT_SECRET and FIELD_ENCRYPTION_KEY",
      );
      expect(configError({ ...FULL_ENV, ...GITHUB_LINK_ENV, FIELD_ENCRYPTION_KEY: "c2hvcnQ=" }).message).toContain(
        "FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded",
      );
    });
  });
});
