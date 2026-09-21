import { createHash, timingSafeEqual } from "node:crypto";

import type { ServiceHandler } from "../locals.js";
import { unauthorized } from "./errors.js";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/** Requires `Authorization: Bearer <SERVICE_TOKEN>` on internal routes (orchestrator, agents). */
export function serviceAuthMiddleware(serviceToken: string): ServiceHandler {
  // Comparing fixed-length digests keeps the check constant-time whatever the token length.
  const expected = digest(serviceToken);

  return (req, _res, next) => {
    const header = req.get("authorization");
    const match = header === undefined ? null : /^Bearer (.+)$/.exec(header);
    if (!match) {
      next(unauthorized("unauthenticated", "A service token is required"));
      return;
    }
    if (!timingSafeEqual(digest(match[1]!), expected)) {
      next(unauthorized("invalid_credentials", "The service token is not valid"));
      return;
    }
    next();
  };
}
