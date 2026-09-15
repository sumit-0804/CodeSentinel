import { ApiErrorSchema } from "@code-sentinel/contracts";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import {
  captureLogger,
  fakeOrchestrator,
  pullRequestEventPayload,
  signedWebhookHeaders,
  testAppDeps,
} from "../test-support/fixtures.js";
import { withServer } from "../test-support/with-server.js";

function webhookApp() {
  const { logger, lines } = captureLogger();
  const createReviewJob = vi.fn(fakeOrchestrator().createReviewJob);
  const app = createApp(testAppDeps({ logger, orchestrator: fakeOrchestrator({ createReviewJob }) }));
  return { app, lines, createReviewJob };
}

async function deliver(app: ReturnType<typeof webhookApp>["app"], body: string, headers: Record<string, string>) {
  let result!: { status: number; body: Record<string, unknown> };
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/webhooks/github`, { method: "POST", body, headers });
    result = { status: response.status, body: (await response.json()) as Record<string, unknown> };
  });
  return result;
}

describe("POST /webhooks/github", () => {
  it("returns 401 invalid_signature for a bad signature", async () => {
    const { app, createReviewJob } = webhookApp();
    const body = JSON.stringify(pullRequestEventPayload());

    const response = await deliver(app, body, signedWebhookHeaders(body, "wrong-secret-0123"));

    expect(response.status).toBe(401);
    expect(ApiErrorSchema.parse(response.body).code).toBe("invalid_signature");
    expect(createReviewJob).not.toHaveBeenCalled();
  });

  it("never parses or forwards an unsigned payload (FR-GW-03)", async () => {
    const { app, lines, createReviewJob } = webhookApp();
    const { "X-Hub-Signature-256": _signature, ...unsigned } = signedWebhookHeaders("{not json");

    const response = await deliver(app, "{not json", unsigned);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("invalid_signature");
    expect(createReviewJob).not.toHaveBeenCalled();
    const logLine = lines.find((line) => line.message === "request");
    expect(logLine).toMatchObject({ status: 401, outcome: "invalid_signature" });
    expect(JSON.stringify(logLine)).not.toContain("not json");
  });

  it("returns 400 missing_header without X-GitHub-Delivery", async () => {
    const { app } = webhookApp();
    const body = JSON.stringify(pullRequestEventPayload());
    const { "X-GitHub-Delivery": _delivery, ...headers } = signedWebhookHeaders(body);

    const response = await deliver(app, body, headers);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("missing_header");
  });

  it("returns 400 invalid_payload for a signed body that is not JSON", async () => {
    const { app } = webhookApp();

    const response = await deliver(app, "{not json", signedWebhookHeaders("{not json"));

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("invalid_payload");
  });
});
