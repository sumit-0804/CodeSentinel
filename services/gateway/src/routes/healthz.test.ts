import { GatewayHealthSchema } from "@code-sentinel/contracts";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { noopLogger } from "../logging/logger.js";
import { testConfig } from "../test-support/fixtures.js";
import { withServer } from "../test-support/with-server.js";

describe("GET /healthz", () => {
  it("answers 200 ok with the version", async () => {
    const app = createApp({ config: testConfig(), logger: noopLogger, version: "1.2.3" });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/healthz`);
      const body = GatewayHealthSchema.parse(await response.json());

      expect(response.status).toBe(200);
      expect(body).toEqual({ status: "ok", version: "1.2.3", dependencies: {} });
    });
  });
});
