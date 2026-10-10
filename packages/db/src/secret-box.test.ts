import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { SecretBox } from "./secret-box.js";

const key = () => randomBytes(32).toString("base64");

describe("SecretBox", () => {
  it("opens what it sealed", () => {
    const box = new SecretBox(key());
    expect(box.open(box.seal("ghu_example-token"))).toBe("ghu_example-token");
  });

  it("uses a fresh IV, so the same value seals differently", () => {
    const box = new SecretBox(key());
    expect(box.seal("same")).not.toBe(box.seal("same"));
  });

  it("rejects a tampered value", () => {
    const box = new SecretBox(key());
    const [version, iv, tag, ciphertext] = box.seal("secret").split(".") as [string, string, string, string];
    const flipped = Buffer.from(ciphertext, "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => box.open([version, iv, tag, flipped.toString("base64url")].join("."))).toThrow();
  });

  it("rejects a value sealed with another key", () => {
    const sealed = new SecretBox(key()).seal("secret");
    expect(() => new SecretBox(key()).open(sealed)).toThrow();
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => new SecretBox(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });

  it("rejects input that is not a sealed value", () => {
    expect(() => new SecretBox(key()).open("plain-text")).toThrow(/not a sealed value/);
  });
});
