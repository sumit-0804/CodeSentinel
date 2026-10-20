import { Router, type Request } from "express";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "@prometheus-io/client";

import { serviceAuthMiddleware } from "./http/service-auth.js";
import type { ServiceHandler } from "./locals.js";

export { Counter, Gauge, Histogram, type Registry };

/** The route pattern, never the raw path, so ids in URLs don't create a series each. */
function routeOf(req: Request): string {
  const pattern = (req.route as { path?: unknown } | undefined)?.path;
  return typeof pattern === "string" ? `${req.baseUrl}${pattern}` : "unmatched";
}

/**
 * Prometheus metrics for one service (WP6): process defaults, a request-duration histogram, and the
 * service's own series on the same registry. Every series carries `service`.
 */
export function createMetrics(service: string) {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });

  const requestDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration by method, route pattern and status",
    labelNames: ["method", "route", "status"] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [registry],
  });

  /** Times every request; mount it first so failed requests are measured too. */
  const httpMiddleware: ServiceHandler = (req, res, next) => {
    const end = requestDuration.startTimer();
    res.on("finish", () => end({ method: req.method, route: routeOf(req), status: String(res.statusCode) }));
    next();
  };

  /** `GET /metrics` behind `Authorization: Bearer <token>`; without a token the route isn't mounted. */
  const router = (token: string | undefined): Router => {
    const metrics = Router();
    if (!token) return metrics;
    metrics.get("/metrics", serviceAuthMiddleware(token), async (_req, res) => {
      res.set("Content-Type", registry.contentType).send(await registry.metrics());
    });
    return metrics;
  };

  return { registry, httpMiddleware, router };
}

export type Metrics = ReturnType<typeof createMetrics>;
