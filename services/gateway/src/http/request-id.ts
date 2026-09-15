import { randomUUID } from "node:crypto";

import type { GatewayHandler } from "../auth/principal.js";

export const REQUEST_ID_HEADER = "X-Request-Id";

/** 1..128 visible ASCII characters; anything else is replaced rather than echoed into logs. */
const VALID_REQUEST_ID = /^[\x21-\x7e]{1,128}$/;

/** Reuses a well-formed inbound `X-Request-Id` or generates a UUID; sets it on `res.locals` and the response (NFR-12). */
export function requestIdMiddleware(): GatewayHandler {
  return (req, res, next) => {
    const inbound = req.get(REQUEST_ID_HEADER);
    const requestId = inbound !== undefined && VALID_REQUEST_ID.test(inbound) ? inbound : randomUUID();
    res.locals.requestId = requestId;
    res.set(REQUEST_ID_HEADER, requestId);
    next();
  };
}
