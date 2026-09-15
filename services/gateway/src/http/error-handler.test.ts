import { ApiErrorSchema } from "@code-sentinel/contracts";
import express from "express";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { captureLogger } from "../test-support/fixtures.js";
import { withServer } from "../test-support/with-server.js";
import { errorHandler, notFoundHandler } from "./error-handler.js";
import { HttpError } from "./errors.js";
import { requestIdMiddleware } from "./request-id.js";

function throwingApp() {
  const { logger, lines } = captureLogger();
  const app = express();
  app.use(requestIdMiddleware());
  app.get("/http-error", () => {
    throw new HttpError(409, "conflict", "Already exists", { reviewId: "r-1" });
  });
  app.get("/zod-error", () => {
    z.object({ repositoryId: z.string().uuid() }).parse({ repositoryId: "nope" });
  });
  app.get("/boom", async () => {
    throw new Error("database password is hunter2");
  });
  app.use(notFoundHandler());
  app.use(errorHandler(logger));
  return { app, lines };
}

async function get(path: string) {
  const { app, lines } = throwingApp();
  let result!: { status: number; body: Record<string, unknown>; requestId: string | null };
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}${path}`);
    result = {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
      requestId: response.headers.get("x-request-id"),
    };
  });
  expect(ApiErrorSchema.safeParse(result.body).success).toBe(true);
  expect(result.body.requestId).toBe(result.requestId);
  return { ...result, lines };
}

describe("errorHandler", () => {
  it("writes an HttpError's status, code, details and the request id", async () => {
    const { status, body } = await get("/http-error");

    expect(status).toBe(409);
    expect(body).toMatchObject({ code: "conflict", message: "Already exists", details: { reviewId: "r-1" } });
  });

  it("maps a zod error to 400 invalid_body with the issues", async () => {
    const { status, body } = await get("/zod-error");

    expect(status).toBe(400);
    expect(body.code).toBe("invalid_body");
    expect(body.details).toMatchObject({ issues: [expect.objectContaining({ path: ["repositoryId"] })] });
  });

  it("hides an unknown error behind 500 internal_error and logs the stack", async () => {
    const { status, body, lines } = await get("/boom");

    expect(status).toBe(500);
    expect(body).toMatchObject({ code: "internal_error", message: "Internal server error" });
    expect(JSON.stringify(body)).not.toContain("hunter2");
    const logged = lines.find((line) => line.message === "unhandled error");
    expect(logged?.error).toMatchObject({ message: "database password is hunter2", stack: expect.any(String) });
  });

  it("answers an unknown route with 404 not_found", async () => {
    const { status, body } = await get("/nowhere");

    expect(status).toBe(404);
    expect(body.code).toBe("not_found");
  });
});
