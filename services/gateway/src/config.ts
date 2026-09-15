import { z } from "zod";

export type GatewaySeed = "none" | "dev";

export interface GatewayConfig {
  port: number;
  /** Orchestrator base URL; a trailing slash is ignored by the client. */
  orchestratorUrl: string;
  orchestratorTimeoutMs: number;
  /** Sent to the orchestrator as `Authorization: Bearer <token>`. */
  serviceToken: string;
  /** HS256 key for the `cs_session` JWT. */
  jwtSecret: string;
  /** Verifies `X-Hub-Signature-256` on every webhook delivery (FR-GW-03). */
  githubWebhookSecret: string;
  /** `dev` loads in-memory demo data; never set in a deployed environment. */
  seed: GatewaySeed;
}

/** Thrown by `loadGatewayConfig` with every invalid variable listed at once. */
export class GatewayConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: string[]) {
    super(`Invalid gateway configuration: ${problems.join("; ")}`);
    this.name = "GatewayConfigError";
    this.problems = problems;
  }
}

/** `PORT=` in a .env file means "use the default", not "empty string". */
const blankAsUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const integer = (min: number, max: number, fallback: number) =>
  z.preprocess(
    blankAsUndefined,
    z.coerce
      .number({ invalid_type_error: "must be an integer" })
      .int("must be an integer")
      .min(min, `must be between ${min} and ${max}`)
      .max(max, `must be between ${min} and ${max}`)
      .default(fallback),
  );

const secret = (minLength: number) =>
  z.preprocess(
    blankAsUndefined,
    z.string().min(minLength, `must be at least ${minLength} characters`),
  );

const EnvSchema = z.object({
  PORT: integer(1, 65535, 3000),
  ORCHESTRATOR_URL: z.preprocess(
    blankAsUndefined,
    z
      .string()
      .url("must be an http or https URL")
      .refine((value) => /^https?:$/.test(new URL(value).protocol), "must be an http or https URL"),
  ),
  ORCHESTRATOR_TIMEOUT_MS: integer(1000, 30000, 5000),
  SERVICE_TOKEN: secret(1),
  // HS256 needs a 256-bit key.
  JWT_SECRET: secret(32),
  GITHUB_WEBHOOK_SECRET: secret(16),
  GATEWAY_SEED: z.preprocess(blankAsUndefined, z.enum(["none", "dev"]).default("none")),
});

/**
 * Reads and validates the gateway environment (see `.env.example`). Every problem is reported in
 * one `GatewayConfigError`, so a bad `.env` fails once at startup rather than variable by variable.
 */
export function loadGatewayConfig(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new GatewayConfigError(
      parsed.error.issues.map((issue) => {
        const name = issue.path.join(".");
        const missing = issue.code === "invalid_type" && issue.received === "undefined";
        return `${name} ${missing ? "is required" : issue.message}`;
      }),
    );
  }

  const values = parsed.data;
  return {
    port: values.PORT,
    orchestratorUrl: values.ORCHESTRATOR_URL,
    orchestratorTimeoutMs: values.ORCHESTRATOR_TIMEOUT_MS,
    serviceToken: values.SERVICE_TOKEN,
    jwtSecret: values.JWT_SECRET,
    githubWebhookSecret: values.GITHUB_WEBHOOK_SECRET,
    seed: values.GATEWAY_SEED,
  };
}
