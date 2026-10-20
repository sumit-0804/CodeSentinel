import { withServer } from "@code-sentinel/service-kit/testing";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { signedWebhookHeaders, testAppDeps, testConfig } from "../test-support/fixtures.js";
import { DEFAULT_RATE_LIMITS } from "./rate-limits.js";

describe("GET /metrics (gateway)", () => {
  it("counts webhook outcomes and rate limits, behind METRICS_TOKEN", async () => {
    const config = testConfig({ metricsToken: "gateway-metrics-token", rateLimits: { ...DEFAULT_RATE_LIMITS, webhookPerMinute: 1 } });
    const body = JSON.stringify({ zen: "Keep it logically awesome.", installation: { id: 7 } });
    const ping = (baseUrl: string) => fetch(`${baseUrl}/webhooks/github`, { method: "POST", headers: signedWebhookHeaders(body, undefined, { event: "ping" }), body });

    await withServer(createApp(testAppDeps({ config })), async (baseUrl) => {
      await ping(baseUrl);
      await ping(baseUrl);

      expect((await fetch(`${baseUrl}/metrics`)).status).toBe(401);
      const text = await (await fetch(`${baseUrl}/metrics`, { headers: { Authorization: "Bearer gateway-metrics-token" } })).text();
      expect(text).toContain('webhook_deliveries_total{event="ping",outcome="event_ignored",service="gateway"} 1');
      expect(text).toContain('webhook_deliveries_total{event="ping",outcome="rate_limited",service="gateway"} 1');
      expect(text).toContain('rate_limited_total{limiter="webhook",service="gateway"} 1');
      // Limiters that never fired are still there at 0, so their first 429 shows up in increase().
      expect(text).toContain('rate_limited_total{limiter="failed_auth",service="gateway"} 0');
      expect(text).toContain('route="/webhooks/github"');
    });
  });
});
