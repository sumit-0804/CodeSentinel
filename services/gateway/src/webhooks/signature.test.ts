import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyGithubSignature } from "./signature.js";

const SECRET = "webhook-secret-for-tests";
const BODY = Buffer.from('{"action":"opened","number":42}');
const sign = (body: Buffer, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifyGithubSignature", () => {
  it("accepts a correctly computed sha256 signature", () => {
    expect(verifyGithubSignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verifyGithubSignature(BODY, sign(BODY, "another-secret"), SECRET)).toBe(false);
  });

  it("rejects a body changed by one byte", () => {
    const tampered = Buffer.from(BODY);
    tampered[tampered.length - 2] = "3".charCodeAt(0);

    expect(verifyGithubSignature(tampered, sign(BODY), SECRET)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyGithubSignature(BODY, undefined, SECRET)).toBe(false);
  });

  it("rejects a sha1= signature", () => {
    const sha1 = `sha1=${createHmac("sha1", SECRET).update(BODY).digest("hex")}`;

    expect(verifyGithubSignature(BODY, sha1, SECRET)).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    expect(() => verifyGithubSignature(BODY, sign(BODY).slice(0, -2), SECRET)).not.toThrow();
    expect(verifyGithubSignature(BODY, sign(BODY).slice(0, -2), SECRET)).toBe(false);
    expect(verifyGithubSignature(BODY, `${sign(BODY)}00`, SECRET)).toBe(false);
  });
});
