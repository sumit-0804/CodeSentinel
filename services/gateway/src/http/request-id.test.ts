import express from "express";
import { describe, expect, it } from "vitest";

import { withServer } from "../test-support/with-server.js";
import { requestIdMiddleware } from "./request-id.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Echoes `res.locals.requestId` so the test sees what downstream handlers see. */
function echoApp() {
  const app = express();
  app.use(requestIdMiddleware());
  app.get("/", (_req, res) => {
    res.json({ requestId: res.locals.requestId as string });
  });
  return app;
}

async function call(headers: Record<string, string> = {}) {
  let result!: { header: string | null; body: { requestId: string } };
  await withServer(echoApp(), async (baseUrl) => {
    const response = await fetch(baseUrl, { headers });
    result = { header: response.headers.get("x-request-id"), body: (await response.json()) as { requestId: string } };
  });
  return result;
}

describe("requestIdMiddleware", () => {
  it("generates a UUID and sets the response header when none is sent", async () => {
    const { header, body } = await call();

    expect(header).toMatch(UUID);
    expect(body.requestId).toBe(header);
  });

  it("reuses a valid inbound X-Request-Id", async () => {
    const { header, body } = await call({ "X-Request-Id": "manual-check-1" });

    expect(header).toBe("manual-check-1");
    expect(body.requestId).toBe("manual-check-1");
  });

  it("replaces an inbound id that is too long or contains control characters", async () => {
    const tooLong = await call({ "X-Request-Id": "a".repeat(129) });
    const withTab = await call({ "X-Request-Id": "bad\tid" });

    expect(tooLong.header).toMatch(UUID);
    expect(withTab.header).toMatch(UUID);
  });
});
