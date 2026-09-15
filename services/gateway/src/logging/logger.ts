export type LogFields = Record<string, unknown>;
export type LogLevel = "info" | "warn" | "error";

/** Structured logger. Every line is one JSON object; bodies are never passed in (NFR-05). */
export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds `fields` to every line it writes. */
  child(fields: LogFields): Logger;
}

export interface LogStream {
  write(chunk: string): unknown;
}

/** Keys whose values are never written, at any depth (NFR-05). */
const SENSITIVE_KEY = /authorization|cookie|secret|signature|token/i;
export const REDACTED = "[redacted]";

/** Replaces sensitive values with `[redacted]` and turns `Error`s into plain objects. */
export function redactFields(fields: LogFields): LogFields {
  const result: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(value);
  }
  return result;
}

function redactValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return redactFields(value as LogFields);
  }
  return value;
}

/** Writes one JSON line per call to `stream` (stdout by default). */
export function createJsonLogger(stream: LogStream = process.stdout, base: LogFields = {}): Logger {
  const write = (level: LogLevel, message: string, fields: LogFields = {}) => {
    const core = { level, time: new Date().toISOString(), message };
    // Core keys come first in the line and cannot be overwritten by fields.
    const line = { ...core, ...redactFields({ ...base, ...fields }), ...core };
    stream.write(`${JSON.stringify(line)}\n`);
  };

  return {
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
    child: (fields) => createJsonLogger(stream, { ...base, ...fields }),
  };
}

/** Discards everything. The default in tests that do not assert on log lines. */
export const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};
