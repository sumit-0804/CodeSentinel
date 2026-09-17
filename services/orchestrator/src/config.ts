import { z } from "zod";

export interface OrchestratorConfig {
  port: number;
  /** Expected from the gateway as `Authorization: Bearer <token>`, and sent to every agent. */
  serviceToken: string;
  /** How long a finished job stays readable before it is dropped from memory. */
  jobRetentionMs: number;
}

/** Thrown by `loadOrchestratorConfig` with every invalid variable listed at once. */
export class OrchestratorConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: string[]) {
    super(`Invalid orchestrator configuration: ${problems.join("; ")}`);
    this.name = "OrchestratorConfigError";
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

const EnvSchema = z.object({
  PORT: integer(1, 65535, 8080),
  SERVICE_TOKEN: z.preprocess(blankAsUndefined, z.string().min(1, "must not be empty")),
  JOB_RETENTION_MS: integer(60_000, 86_400_000, 3_600_000),
});

/**
 * Reads and validates the orchestrator's HTTP settings (see `.env.example`). Agent URLs and the
 * agent timeout are read separately by `loadAgentConfig()`.
 */
export function loadOrchestratorConfig(env: Record<string, string | undefined> = process.env): OrchestratorConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new OrchestratorConfigError(
      parsed.error.issues.map((issue) => {
        const name = issue.path.join(".");
        const missing = issue.code === "invalid_type" && issue.received === "undefined";
        return `${name} ${missing ? "is required" : issue.message}`;
      }),
    );
  }

  const values = parsed.data;
  return { port: values.PORT, serviceToken: values.SERVICE_TOKEN, jobRetentionMs: values.JOB_RETENTION_MS };
}
