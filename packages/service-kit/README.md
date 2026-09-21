# @code-sentinel/service-kit

The HTTP plumbing every Code-Sentinel service shares, so the gateway, the orchestrator and the agent
services log, trace and fail the same way. Moved out of the gateway unchanged.

| Export | Module | What it does |
| --- | --- | --- |
| `createJsonLogger`, `noopLogger`, `redactFields`, `Logger` | `logging/logger.ts` | One JSON line per call; keys matching `authorization`, `cookie`, `secret`, `signature` or `token` are written as `[redacted]` at any depth (NFR-05) |
| `requestIdMiddleware`, `REQUEST_ID_HEADER` | `http/request-id.ts` | Reuses a well-formed inbound `X-Request-Id` or generates a UUID; sets `res.locals.requestId` and the response header (NFR-12) |
| `requestLoggerMiddleware` | `http/request-logger.ts` | morgan writing one redacted JSON line per request: method, path without query, status, duration, request id and `res.locals.logFields` |
| `HttpError`, `badRequest`, `unauthorized`, `notFound`, `unprocessable`, `badGateway` | `http/errors.ts` | Throw from any handler to answer with that status and an `ApiError` body |
| `errorHandler`, `notFoundHandler` | `http/error-handler.ts` | `HttpError` → its status; `ZodError` → 400 `invalid_body` with the issues; body-parser errors → 413 / 415; anything else → 500 `internal_error` with detail in the log only. Every body echoes `requestId` |
| `loadEnvFile`, `envFileName` | `env-file.ts` | Merges `.env` (or `.env.production` when `NODE_ENV=production`) under the process environment; real variables win |
| `serviceAuthMiddleware` | `http/service-auth.ts` | Requires `Authorization: Bearer <SERVICE_TOKEN>` on internal routes; compares SHA-256 digests in constant time. 401 `unauthenticated` without a bearer token, `invalid_credentials` for a wrong one |
| `ServiceLocals`, `ServiceResponse`, `ServiceHandler` | `locals.ts` | Types for `res.locals`; a service extends `ServiceLocals` with its own fields |

Test helpers live under a separate entry point so they never load in production code:

```ts
import { captureLogger, withServer } from "@code-sentinel/service-kit/testing";
```

`withServer(app, fn)` runs an Express app on an ephemeral port and closes every connection after
`fn`. `captureLogger()` returns a real JSON logger plus the parsed lines it wrote.

## Usage

Mount order in a service's `createApp`:

```ts
app.use(requestIdMiddleware());
app.use(requestLoggerMiddleware(logger));
app.use(helmet());
// ...routes...
app.use(notFoundHandler());
app.use(errorHandler(logger));
```

## Develop

```bash
npm run test -w @code-sentinel/service-kit   # needs a prior `npm run build -w @code-sentinel/contracts`
npm run build -w @code-sentinel/service-kit
```
