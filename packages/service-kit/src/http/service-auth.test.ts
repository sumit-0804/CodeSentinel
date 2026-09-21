import express from "express";
import { describe, expect, it } from "vitest";

import { noopLogger } from "../logging/logger.js";
import { withServer } from "../testing/with-server.js";
import { errorHandler } from "./error-handler.js";
import { requestIdMiddleware } from "./request-id.js";
import { serviceAuthMiddleware } from "./service-auth.js";

function app() {
  const server = express();
  server.use(requestIdMiddleware());
  server.use(serviceAuthMiddleware("s3cret-token"));
  server.get("/", (_req, res) => {
    res.json({ ok: true });
  });
  server.use(errorHandler(noopLogger));
  return server;
}

async function call(headers: Record<string, string>) {
  let result!: { status: number; code: unknown };
  await withServer(app(), async (baseUrl) => {
    const response = await fetch(baseUrl, { headers });
    const body = (await response.json()) as Record<string, unknown>;
    result = { status: response.status, code: body.code ?? body.ok };
  });
  return result;
}

describe("serviceAuthMiddleware", () => {
  it("lets the right bearer token through", async () => {
    expect(await call({ Authorization: "Bearer s3cret-token" })).toEqual({ status: 200, code: true });
  });

  it("answers 401 unauthenticated without a bearer token and invalid_credentials for a wrong one", async () => {
    expect(await call({})).toEqual({ status: 401, code: "unauthenticated" });
    expect(await call({ Authorization: "Basic abc" })).toEqual({ status: 401, code: "unauthenticated" });
    expect(await call({ Authorization: "Bearer s3cret-tokex" })).toEqual({ status: 401, code: "invalid_credentials" });
  });
});
