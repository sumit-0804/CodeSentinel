import { describe, expect, it } from "vitest";

import { checkDependency } from "./health.js";

describe("checkDependency", () => {
  it("is ok when the probe resolves in time", async () => {
    await expect(checkDependency(async () => 1)).resolves.toBe("ok");
  });

  it("is unavailable when the probe rejects", async () => {
    await expect(
      checkDependency(async () => {
        throw new Error("connection refused");
      }),
    ).resolves.toBe("unavailable");
  });

  it("is unavailable when the probe hangs past the timeout", async () => {
    await expect(checkDependency(() => new Promise(() => {}), 20)).resolves.toBe("unavailable");
  });
});
