import { describe, expect, it } from "vitest";

import { loadOrchestratorConfig, OrchestratorConfigError } from "./config.js";

describe("loadOrchestratorConfig", () => {
  it("applies defaults when only the service token is set, treating blanks as unset", () => {
    expect(loadOrchestratorConfig({ SERVICE_TOKEN: "token", PORT: "", JOB_RETENTION_MS: " " })).toEqual({
      port: 8080,
      serviceToken: "token",
      jobRetentionMs: 3_600_000,
      llmAgentTimeoutMs: 45_000,
    });
  });

  it("reads explicit values", () => {
    expect(loadOrchestratorConfig({ SERVICE_TOKEN: "token", PORT: "9090", JOB_RETENTION_MS: "60000" })).toMatchObject({
      port: 9090,
      jobRetentionMs: 60_000,
    });
  });

  it("reports every invalid variable in one error", () => {
    let error: unknown;
    try {
      loadOrchestratorConfig({ PORT: "http", JOB_RETENTION_MS: "10" });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(OrchestratorConfigError);
    expect((error as OrchestratorConfigError).problems).toEqual([
      "PORT must be an integer",
      "SERVICE_TOKEN is required",
      "JOB_RETENTION_MS must be between 60000 and 86400000",
    ]);
  });

  describe("DATABASE_URL", () => {
    const DB_URL = "postgresql://prisma.ref:secret@aws-0-ap-south-1.pooler.supabase.com:5432/postgres";

    function problems(env: Record<string, string>): readonly string[] {
      try {
        loadOrchestratorConfig(env);
      } catch (error) {
        return (error as OrchestratorConfigError).problems;
      }
      return [];
    }

    it("is optional and read when set", () => {
      expect(loadOrchestratorConfig({ SERVICE_TOKEN: "token" }).databaseUrl).toBeUndefined();
      expect(loadOrchestratorConfig({ SERVICE_TOKEN: "token", DATABASE_URL: DB_URL }).databaseUrl).toBe(DB_URL);
    });

    it("rejects a URL that is not postgres, without echoing it", () => {
      const found = problems({ SERVICE_TOKEN: "token", DATABASE_URL: "mysql://user:secret@db/x" });

      expect(found).toEqual(["DATABASE_URL must be a postgres:// or postgresql:// URL"]);
    });

    it("is required in production", () => {
      expect(problems({ SERVICE_TOKEN: "token", NODE_ENV: "production" })).toEqual(["DATABASE_URL is required when NODE_ENV is production"]);
      expect(problems({ SERVICE_TOKEN: "token", NODE_ENV: "production", DATABASE_URL: DB_URL })).toEqual([]);
    });
  });
});
