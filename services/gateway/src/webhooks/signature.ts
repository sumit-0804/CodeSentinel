import { createHmac, timingSafeEqual } from "node:crypto";

import type { GatewayHandler } from "../auth/principal.js";
import { unauthorized } from "../http/errors.js";

export const SIGNATURE_HEADER = "X-Hub-Signature-256";
const PREFIX = "sha256=";

/** Constant-time check of `sha256=<hex HMAC>` over the exact raw bytes; never throws (FR-GW-03, NFR-05). */
export function verifyGithubSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader?.startsWith(PREFIX)) return false;

  const expected = Buffer.from(`${PREFIX}${createHmac("sha256", secret).update(rawBody).digest("hex")}`, "utf8");
  const received = Buffer.from(signatureHeader, "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Rejects with 401 `invalid_signature` before anything reads the body; expects `express.raw` in front. */
export function createSignatureMiddleware(secret: string): GatewayHandler {
  return (req, res, next) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifyGithubSignature(rawBody, req.get(SIGNATURE_HEADER), secret)) {
      res.locals.logFields = {
        deliveryId: req.get("x-github-delivery"),
        event: req.get("x-github-event"),
        outcome: "invalid_signature",
      };
      throw unauthorized("invalid_signature", "Webhook signature verification failed");
    }
    next();
  };
}
