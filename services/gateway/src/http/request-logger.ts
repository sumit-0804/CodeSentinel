import type { IncomingMessage, ServerResponse } from "node:http";

import morgan from "morgan";

import type { GatewayLocals } from "../auth/principal.js";
import type { LogFields, Logger } from "../logging/logger.js";

type LoggedRequest = IncomingMessage & { originalUrl?: string };
type LoggedResponse = ServerResponse & { locals?: Partial<GatewayLocals> };

/**
 * morgan writing one JSON line per request through the redacting logger (NFR-12, NFR-05).
 * Custom format: no query string, headers or bodies, unlike morgan's presets.
 */
export function requestLoggerMiddleware(logger: Logger) {
  return morgan<LoggedRequest, LoggedResponse>(
    (tokens, req, res) => {
      const responseTime = Number(tokens["response-time"]?.(req, res));
      const fields: LogFields = {
        method: req.method,
        path: (req.originalUrl ?? req.url ?? "").split("?")[0],
        status: res.headersSent ? res.statusCode : undefined,
        durationMs: Number.isFinite(responseTime) ? Math.round(responseTime) : undefined,
        requestId: res.locals?.requestId,
        ...res.locals?.logFields,
      };
      return JSON.stringify(fields);
    },
    {
      stream: {
        write: (line: string) => {
          const fields = JSON.parse(line) as LogFields;
          if (typeof fields.status !== "number" || fields.status >= 500) logger.error("request", fields);
          else logger.info("request", fields);
        },
      },
    },
  );
}
