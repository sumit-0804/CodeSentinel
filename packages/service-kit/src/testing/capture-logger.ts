import { createJsonLogger, type Logger } from "../logging/logger.js";

/** A real JSON logger whose lines are captured and parsed, for tests that assert on logging. */
export function captureLogger(): { logger: Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const logger = createJsonLogger({
    write: (chunk: string) => lines.push(JSON.parse(chunk) as Record<string, unknown>),
  });
  return { logger, lines };
}
