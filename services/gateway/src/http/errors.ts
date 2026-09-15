/**
 * An error that maps directly to an `ApiError` response. Throw it (or pass it to `next`) from any
 * handler; the error handler writes `{ code, message, details?, requestId }` with `status`.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const badRequest = (code: string, message: string, details?: Record<string, unknown>) =>
  new HttpError(400, code, message, details);

export const unauthorized = (code: string, message: string) => new HttpError(401, code, message);

export const badGateway = (code: string, message: string, details?: Record<string, unknown>) =>
  new HttpError(502, code, message, details);
