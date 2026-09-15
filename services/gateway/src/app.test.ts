import { ApiErrorSchema } from "@code-sentinel/contracts";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { testAppDeps } from "./test-support/fixtures.js";
import { withServer } from "./test-support/with-server.js";

const app = () => createApp(testAppDeps());

describe("createApp", () => {
  it("sets X-Request-Id and security headers on every response", async () => {
    await withServer(app(), async (baseUrl) => {
      for (const path of ["/healthz", "/v1/me", "/does-not-exist"]) {
        const response = await fetch(`${baseUrl}${path}`);
        expect(response.headers.get("x-request-id")).toBeTruthy();
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("x-powered-by")).toBeNull();
      }
    });
  });

  it("answers a JSON body over 1 MB on /v1 with 413 and an ApiError body", async () => {
    await withServer(app(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/me`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ padding: "x".repeat(1024 * 1024 + 1) }),
      });
      const body = ApiErrorSchema.parse(await response.json());

      expect(response.status).toBe(413);
      expect(body.code).toBe("payload_too_large");
      expect(body.requestId).toBe(response.headers.get("x-request-id"));
    });
  });
});
