import type { AgentKind } from "@code-sentinel/contracts";
import { z } from "zod";

export interface OrchestratorConfig {
  port: number;
  /** Expected from the gateway as `Authorization: Bearer <token>`, and sent to every agent. */
  serviceToken: string;
  /** How long a finished job stays readable before it is dropped from memory. */
  jobRetentionMs: number;
  /** Minimum per-agent timeout for LLM agents; a Gemini call can take over 20 s on the free tier. */
  llmAgentTimeoutMs: number;
  /** How long to wake a sleeping agent host before its review call; 0 = don't (always-on agents). */
  agentWakeMs: number;
  /** Supabase Postgres (session pooler). Set → reviews are stored in `reviews`; unset → in memory. */
  databaseUrl?: string;
  /** Which Groq account (organization) each LLM agent calls with; agents on one account share its quota. */
  groqAccounts: Partial<Record<AgentKind, string>>;
  /** Bearer token for `GET /metrics`; unset → no /metrics route. */
  metricsToken?: string;
  /** Similar past issues (vector context): findings looked up per review, the time limit and the match score. */
  context: { maxFindings: number; timeoutMs: number; minSimilarity: number };
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

export const DEFAULT_GROQ_ACCOUNT = "default";

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

/** A Groq account name; agents left unset use `default`, the orchestrator's own GROQ_API_KEY account. */
const account = z.preprocess(blankAsUndefined, z.string().regex(/^[a-z0-9_-]{1,32}$/, "must be a short lowercase name").default(DEFAULT_GROQ_ACCOUNT));

const EnvSchema = z.object({
  PORT: integer(1, 65535, 8080),
  SERVICE_TOKEN: z.preprocess(blankAsUndefined, z.string().min(1, "must not be empty")),
  JOB_RETENTION_MS: integer(60_000, 86_400_000, 3_600_000),
  LLM_AGENT_TIMEOUT_MS: integer(1_000, 120_000, 45_000),
  AGENT_WAKE_TIMEOUT_MS: integer(0, 180_000, 0),
  DATABASE_URL: z.preprocess(
    blankAsUndefined,
    z.string().regex(/^postgres(ql)?:\/\/\S+$/, "must be a postgres:// or postgresql:// URL").optional(),
  ),
  GROQ_ACCOUNT_SECURITY: account,
  GROQ_ACCOUNT_PERFORMANCE: account,
  GROQ_ACCOUNT_LOGIC: account,
  GROQ_ACCOUNT_DOCUMENTATION: account,
  METRICS_TOKEN: z.preprocess(blankAsUndefined, z.string().min(16, "must be at least 16 characters").optional()),
  CONTEXT_MAX_FINDINGS: integer(1, 100, 20),
  CONTEXT_TIMEOUT_MS: integer(500, 30_000, 5000),
  CONTEXT_MIN_SIMILARITY: z.preprocess(
    blankAsUndefined,
    z.coerce.number({ invalid_type_error: "must be a number" }).gt(0, "must be in (0, 1]").max(1, "must be in (0, 1]").default(0.8),
  ),
  NODE_ENV: z.string().optional(),
}).refine((values) => values.NODE_ENV !== "production" || values.DATABASE_URL !== undefined, {
  // In memory, a restart loses every review a deployed gateway is still waiting on.
  message: "is required when NODE_ENV is production",
  path: ["DATABASE_URL"],
});

/**
 * Reads and validates the orchestrator's own settings (see `.env.example`). Agent URLs are read by
 * `loadAgentConfig()`, LLM keys and limits by `loadLlmLimits()` from `@code-sentinel/llm`.
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
  return {
    port: values.PORT,
    serviceToken: values.SERVICE_TOKEN,
    jobRetentionMs: values.JOB_RETENTION_MS,
    llmAgentTimeoutMs: values.LLM_AGENT_TIMEOUT_MS,
    agentWakeMs: values.AGENT_WAKE_TIMEOUT_MS,
    groqAccounts: {
      security: values.GROQ_ACCOUNT_SECURITY,
      performance: values.GROQ_ACCOUNT_PERFORMANCE,
      logic: values.GROQ_ACCOUNT_LOGIC,
      documentation: values.GROQ_ACCOUNT_DOCUMENTATION,
    },
    context: {
      maxFindings: values.CONTEXT_MAX_FINDINGS,
      timeoutMs: values.CONTEXT_TIMEOUT_MS,
      minSimilarity: values.CONTEXT_MIN_SIMILARITY,
    },
    ...(values.DATABASE_URL !== undefined ? { databaseUrl: values.DATABASE_URL } : {}),
    ...(values.METRICS_TOKEN !== undefined ? { metricsToken: values.METRICS_TOKEN } : {}),
  };
}
