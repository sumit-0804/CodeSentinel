import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadEnvFile } from "./env-file.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gateway-env-"));
  writeFileSync(join(dir, ".env"), "PORT=3001\nGATEWAY_SEED=dev\n");
  writeFileSync(join(dir, ".env.production"), "PORT=8443\nGATEWAY_SEED=none\n");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadEnvFile", () => {
  it("reads .env when NODE_ENV is not production", () => {
    const { env, file } = loadEnvFile(dir, { NODE_ENV: "development" });

    expect(file).toBe(join(dir, ".env"));
    expect(env).toMatchObject({ PORT: "3001", GATEWAY_SEED: "dev" });
  });

  it("reads .env.production when NODE_ENV is production", () => {
    const { env, file } = loadEnvFile(dir, { NODE_ENV: "production" });

    expect(file).toBe(join(dir, ".env.production"));
    expect(env).toMatchObject({ PORT: "8443", GATEWAY_SEED: "none" });
  });

  it("lets real environment variables override the file", () => {
    const { env } = loadEnvFile(dir, { NODE_ENV: "production", PORT: "9000" });

    expect(env).toMatchObject({ PORT: "9000", GATEWAY_SEED: "none" });
  });

  it("returns the environment unchanged when the file is missing", () => {
    rmSync(join(dir, ".env.production"));

    expect(loadEnvFile(dir, { NODE_ENV: "production", PORT: "9000" })).toEqual({
      env: { NODE_ENV: "production", PORT: "9000" },
    });
  });
});
