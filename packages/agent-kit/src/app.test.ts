import { describe, expect, it } from "vitest";

import { AgentReviewResponseSchema, ApiErrorSchema, CapabilitiesSchema, HealthSchema } from "@code-sentinel/contracts";
import { EXAMPLE_REVIEW_ID } from "@code-sentinel/contracts/examples";
import { noopLogger } from "@code-sentinel/service-kit";
import { withServer } from "@code-sentinel/service-kit/testing";
import { createAgentService } from "./app.js";
import { loadAgentEnv } from "./config.js";
import { fakeAgent, file } from "./test-support.js";

const TOKEN = "agent-token";
const AUTH = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function call(app: ReturnType<typeof createAgentService>, path: string, init: RequestInit = {}) {
  let result!: { status: number; body: Record<string, unknown> };
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}${path}`, init);
    result = { status: response.status, body: (await response.json()) as Record<string, unknown> };
  });
  return result;
}

const service = (agent = fakeAgent()) => createAgentService({ agent, serviceToken: TOKEN, logger: noopLogger });
const review = (body: unknown, headers: Record<string, string> = AUTH) => ({ method: "POST", headers, body: JSON.stringify(body) });

describe("agent service", () => {
  it("answers POST /v1/review with a contract-valid response", async () => {
    const { status, body } = await call(service(), "/v1/review", review({ reviewId: EXAMPLE_REVIEW_ID, files: [file("a.py")] }));

    expect(status).toBe(200);
    expect(AgentReviewResponseSchema.parse(body).findings).toHaveLength(1);
  });

  it("requires the service token, a valid body and a body under maxDiffBytes", async () => {
    const noToken = await call(service(), "/v1/review", review({}, { "Content-Type": "application/json" }));
    const invalid = await call(service(), "/v1/review", review({ reviewId: "nope", files: [] }));
    const tooBig = await call(service(), "/v1/review", review({ reviewId: EXAMPLE_REVIEW_ID, files: [file("a.py", "x".repeat(3_000))] }));

    expect(noToken.status).toBe(401);
    expect([invalid.status, ApiErrorSchema.parse(invalid.body).code]).toEqual([400, "invalid_body"]);
    expect([tooBig.status, tooBig.body.code]).toEqual([413, "payload_too_large"]);
  });

  it("answers 503 llm_unavailable when quota was reserved on a provider it has no key for", async () => {
    const { status, body } = await call(
      service(),
      "/v1/review",
      review({ reviewId: EXAMPLE_REVIEW_ID, files: [file("a.py")], options: { llmProvider: "groq" } }),
    );

    expect([status, body.code]).toEqual([503, "llm_unavailable"]);
  });

  it("describes itself on /v1/capabilities without a token", async () => {
    const { status, body } = await call(service(), "/v1/capabilities");

    expect(status).toBe(200);
    expect(CapabilitiesSchema.parse(body)).toMatchObject({ agent: "security", usesLlm: true, maxDiffBytes: 2000, maxFileTokens: 100 });
  });

  it("reports degraded health without an LLM key, and 503 when a dependency is down", async () => {
    const degraded = await call(service(), "/healthz");
    const down = await call(service(fakeAgent({ usesLlm: false, health: async () => ({ sandbox: "unavailable" }) })), "/healthz");

    expect(degraded.status).toBe(200);
    expect(HealthSchema.parse(degraded.body)).toMatchObject({ status: "degraded", checks: { llmProvider: "degraded" } });
    expect(down.status).toBe(503);
    expect(down.body).toMatchObject({ status: "unavailable", checks: { sandbox: "unavailable" } });
  });
});

describe("loadAgentEnv", () => {
  it("defaults the port, requires the token, and builds an LLM client only for LLM agents with a key", () => {
    const withKey = loadAgentEnv({ SERVICE_TOKEN: "t", GROQ_API_KEY: "g" }, { defaultPort: 8081, usesLlm: true });
    const style = loadAgentEnv({ SERVICE_TOKEN: "t", GROQ_API_KEY: "g" }, { defaultPort: 8082, usesLlm: false });

    expect(withKey.port).toBe(8081);
    expect(withKey.llm?.has("groq")).toBe(true);
    expect(style.llm).toBeUndefined();
    expect(() => loadAgentEnv({ PORT: "x", GROQ_TPM: "lots" }, { defaultPort: 8081, usesLlm: true })).toThrow(
      /PORT must be an integer; SERVICE_TOKEN is required; GROQ_TPM must be an integer/,
    );
  });
});
