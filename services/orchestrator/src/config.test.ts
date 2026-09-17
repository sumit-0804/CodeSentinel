import { describe, expect, it } from "vitest";

import { loadOrchestratorConfig, OrchestratorConfigError } from "./config.js";

describe("loadOrchestratorConfig", () => {
  it("applies defaults when only the service token is set, treating blanks as unset", () => {
    expect(loadOrchestratorConfig({ SERVICE_TOKEN: "token", PORT: "", JOB_RETENTION_MS: " " })).toEqual({
      port: 8080,
      serviceToken: "token",
      jobRetentionMs: 3_600_000,
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
});
