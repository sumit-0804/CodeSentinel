import { describe, expect, it } from "vitest";

import { AgentClient } from "./agent-client.js";
import { createAgentClients, loadAgentConfig } from "./agent-config.js";

describe("loadAgentConfig", () => {
  it("reads the five agent URLs and the service token", () => {
    const config = loadAgentConfig({
      AGENT_SECURITY_URL: "http://security-agent.internal:8081",
      AGENT_STYLE_URL: "http://style-agent.internal:8082",
      AGENT_PERFORMANCE_URL: "http://performance-agent.internal:8083",
      AGENT_LOGIC_URL: "http://logic-agent.internal:8084",
      AGENT_DOCUMENTATION_URL: "http://documentation-agent.internal:8085",
      SERVICE_TOKEN: "service-token",
      AGENT_TIMEOUT_MS: "15000",
    });

    expect(config).toEqual({
      urls: {
        security: "http://security-agent.internal:8081",
        style: "http://style-agent.internal:8082",
        performance: "http://performance-agent.internal:8083",
        logic: "http://logic-agent.internal:8084",
        documentation: "http://documentation-agent.internal:8085",
      },
      serviceToken: "service-token",
      timeoutMs: 15000,
    });
  });

  it("leaves a missing or blank URL out of the map", () => {
    const config = loadAgentConfig({ AGENT_SECURITY_URL: "http://127.0.0.1:8081", AGENT_STYLE_URL: " " });

    expect(config.urls).toEqual({ security: "http://127.0.0.1:8081" });
    expect(config).not.toHaveProperty("serviceToken");
  });

  it("defaults the timeout to 20000 ms", () => {
    expect(loadAgentConfig({}).timeoutMs).toBe(20000);
  });

  it.each(["abc", "500", "120001", "1500.5"])("throws on AGENT_TIMEOUT_MS=%s", (value) => {
    expect(() => loadAgentConfig({ AGENT_TIMEOUT_MS: value })).toThrow(/AGENT_TIMEOUT_MS/);
  });
});

describe("createAgentClients", () => {
  it("creates a client only for configured agents", () => {
    const clients = createAgentClients(
      loadAgentConfig({ AGENT_SECURITY_URL: "http://127.0.0.1:8081", AGENT_LOGIC_URL: "http://127.0.0.1:8084" }),
    );

    expect(Object.keys(clients)).toEqual(["security", "logic"]);
    expect(clients.security).toBeInstanceOf(AgentClient);
    expect(clients.logic?.agent).toBe("logic");
  });
});
