import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { noopLogger } from "./logging/logger.js";
import { testConfig } from "./test-support/fixtures.js";
import { withServer } from "./test-support/with-server.js";

describe("createApp", () => {
  it("sets X-Request-Id and security headers on every response", async () => {
    const app = createApp({ config: testConfig(), logger: noopLogger });

    await withServer(app, async (baseUrl) => {
      for (const path of ["/healthz", "/does-not-exist"]) {
        const response = await fetch(`${baseUrl}${path}`);
        expect(response.headers.get("x-request-id")).toBeTruthy();
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("x-powered-by")).toBeNull();
      }
    });
  });
});
