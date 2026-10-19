import { Counter, createMetrics, type ServiceHandler } from "@code-sentinel/service-kit";

/** The gateway's Prometheus series on top of the kit's request histogram (WP6). */
export function createGatewayMetrics() {
  const metrics = createMetrics("gateway");
  const deliveries = new Counter({
    name: "webhook_deliveries_total",
    help: "GitHub webhook deliveries by event and outcome (review_started, event_ignored, rate_limited, ...)",
    labelNames: ["event", "outcome"] as const,
    registers: [metrics.registry],
  });
  const rateLimited = new Counter({
    name: "rate_limited_total",
    help: "Requests answered 429 by limiter",
    labelNames: ["limiter"] as const,
    registers: [metrics.registry],
  });

  /** Reads the outcome the webhook route wrote to its log fields, once the response is sent. */
  const webhookOutcomes: ServiceHandler = (req, res, next) => {
    res.on("finish", () => {
      const outcome = res.statusCode === 429 ? "rate_limited" : res.locals.logFields?.outcome;
      deliveries.inc({ event: req.get("x-github-event") ?? "unknown", outcome: typeof outcome === "string" ? outcome : `http_${res.statusCode}` });
    });
    next();
  };

  return { ...metrics, rateLimited, webhookOutcomes };
}
