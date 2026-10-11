import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT_PATH, safeNextPath } from "./safe-next-path";

describe("safeNextPath", () => {
  it.each(["/overview", "/repositories?tab=agents", "/settings#sessions", "/a/b/c"])("keeps the same-origin path %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "https://evil.example/overview",
    "javascript:alert(1)",
    "overview",
    "/\t/evil.example",
    "/\n/evil.example",
    "",
    undefined,
    null,
    ["/overview"],
    `/${"a".repeat(3000)}`,
  ])("falls back for %j", (value) => {
    expect(safeNextPath(value)).toBe(DEFAULT_NEXT_PATH);
  });

  it("normalises dot segments so they can't climb out", () => {
    expect(safeNextPath("/settings/../overview")).toBe("/overview");
  });

  it("uses the given fallback", () => {
    expect(safeNextPath("//evil.example", "/settings")).toBe("/settings");
  });
});
