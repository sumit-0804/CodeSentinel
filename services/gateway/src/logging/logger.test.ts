import { describe, expect, it } from "vitest";

import { captureLogger } from "../test-support/fixtures.js";

describe("createJsonLogger", () => {
  it("writes one JSON line with level, message, time and the fields", () => {
    const { logger, lines } = captureLogger();

    logger.warn("orchestrator slow", { requestId: "req-1", durationMs: 812 });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "warn", message: "orchestrator slow", requestId: "req-1", durationMs: 812 });
    expect(new Date(lines[0]!.time as string).toString()).not.toBe("Invalid Date");
  });

  it("merges child fields into every line", () => {
    const { logger, lines } = captureLogger();
    const child = logger.child({ deliveryId: "delivery-1" });

    child.info("first");
    child.error("second", { outcome: "failed" });

    expect(lines).toEqual([
      expect.objectContaining({ message: "first", deliveryId: "delivery-1" }),
      expect.objectContaining({ message: "second", deliveryId: "delivery-1", outcome: "failed", level: "error" }),
    ]);
  });

  it("redacts authorization, cookie, signature and secret fields (NFR-05)", () => {
    const { logger, lines } = captureLogger();

    logger.info("headers", {
      authorization: "Bearer cs_live_abc",
      headers: { cookie: "cs_session=jwt", "x-hub-signature-256": "sha256=abc" },
      secret: "webhook-secret",
      path: "/v1/me",
    });

    expect(lines[0]).toMatchObject({
      authorization: "[redacted]",
      headers: { cookie: "[redacted]", "x-hub-signature-256": "[redacted]" },
      secret: "[redacted]",
      path: "/v1/me",
    });
    expect(JSON.stringify(lines[0])).not.toMatch(/cs_live_abc|jwt|sha256=abc|webhook-secret/);
  });
});
