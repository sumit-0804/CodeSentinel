import { DEFAULT_MFA_STEP_UP_MINUTES } from "@code-sentinel/contracts";
import { z } from "zod";

import { DEFAULT_FILE_CONTENT_MAX_BYTES } from "./webhooks/file-contents.js";

export type GatewaySeed = "none" | "dev";

export interface GatewayConfig {
  port: number;
  /** Orchestrator base URL; a trailing slash is ignored by the client. */
  orchestratorUrl: string;
  orchestratorTimeoutMs: number;
  /** Sent to the orchestrator as `Authorization: Bearer <token>`. */
  serviceToken: string;
  /** Supabase project URL; dashboard tokens are verified against its JWKS. Unset → every `/v1` call is 401. */
  supabaseUrl?: string;
  /** The dashboard's base URL, no trailing slash; comments on GitHub link to a review's page there when set. */
  dashboardUrl?: string;
  /** Verifies `X-Hub-Signature-256` on every webhook delivery (FR-GW-03). */
  githubWebhookSecret: string;
  /** `dev` loads in-memory demo data; never set in a deployed environment. */
  seed: GatewaySeed;
  /** Supabase Postgres (session pooler). Set → Prisma stores; unset → in-memory stores and `seed`. */
  databaseUrl?: string;
  /** Set together; without them PR files come from the stub client (dev and tests only). */
  githubApp?: { appId: number; privateKeyPath: string };
  /** The App's OAuth credentials and the key that seals user tokens; without them GitHub linking answers 503. */
  githubLink?: { clientId: string; clientSecret: string; fieldEncryptionKey: string };
  /** Points the dev seed's repository at a real repo, e.g. the test playground. */
  devRepository?: { fullName: string; githubRepoId: number };
  /** How long to wait for a review job before completing its Check Run as timed out. */
  reviewPollTimeoutMs: number;
  /** How recent the TOTP code on a token must be for configuration writes (A7). */
  mfaStepUpMinutes: number;
  /** Changed files up to this size go to the agents whole; larger ones as diffs only. 0 sends diffs only. */
  fileContentMaxBytes: number;
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

const httpUrl = z
  .string()
  .url("must be an http or https URL")
  // `.url()` already reports unparseable values; this only rejects other schemes such as ftp:.
  .refine((value) => !URL.canParse(value) || /^https?:$/.test(new URL(value).protocol), "must be an http or https URL");

const EnvSchema = z.object({
  PORT: integer(1, 65535, 3000),
  ORCHESTRATOR_URL: z.preprocess(blankAsUndefined, httpUrl),
  ORCHESTRATOR_TIMEOUT_MS: integer(1000, 30000, 5000),
  REVIEW_POLL_TIMEOUT_MS: integer(10_000, 1_800_000, 300_000),
  MFA_STEP_UP_MINUTES: integer(1, 60, DEFAULT_MFA_STEP_UP_MINUTES),
  FILE_CONTENT_MAX_BYTES: integer(0, 1_000_000, DEFAULT_FILE_CONTENT_MAX_BYTES),
  SERVICE_TOKEN: secret(1),
  SUPABASE_URL: z.preprocess(blankAsUndefined, httpUrl.optional()),
  DASHBOARD_URL: z.preprocess(blankAsUndefined, httpUrl.optional()),
  GITHUB_WEBHOOK_SECRET: secret(16),
  GATEWAY_SEED: z.preprocess(blankAsUndefined, z.enum(["none", "dev"]).default("none")),
  DATABASE_URL: z.preprocess(
    blankAsUndefined,
    z.string().regex(/^postgres(ql)?:\/\/\S+$/, "must be a postgres:// or postgresql:// URL").optional(),
  ),
  GITHUB_APP_ID: z.preprocess(blankAsUndefined, z.coerce.number({ invalid_type_error: "must be an integer" }).int("must be an integer").positive("must be positive").optional()),
  GITHUB_PRIVATE_KEY_PATH: z.preprocess(blankAsUndefined, z.string().optional()),
  GITHUB_APP_CLIENT_ID: z.preprocess(blankAsUndefined, z.string().optional()),
  GITHUB_APP_CLIENT_SECRET: z.preprocess(blankAsUndefined, z.string().min(20, "must be at least 20 characters").optional()),
  // AES-256-GCM key for sealed GitHub tokens: exactly 32 bytes, base64-encoded.
  FIELD_ENCRYPTION_KEY: z.preprocess(
    blankAsUndefined,
    z
      .string()
      .refine((value) => Buffer.from(value, "base64").length === 32, "must be 32 bytes, base64-encoded")
      .optional(),
  ),
  GATEWAY_DEV_REPOSITORY: z.preprocess(
    blankAsUndefined,
    z.string().regex(/^[\w.-]+\/[\w.-]+:\d+$/, "must look like owner/name:githubRepoId").optional(),
  ),
  NODE_ENV: z.string().optional(),
})
  .refine((values) => !(values.NODE_ENV === "production" && values.GATEWAY_SEED === "dev"), {
    // The dev seed is fake demo data, so it must never load in production.
    message: "must be none when NODE_ENV is production",
    path: ["GATEWAY_SEED"],
  })
  .refine((values) => !(values.DATABASE_URL !== undefined && values.GATEWAY_SEED === "dev"), {
    // The dev seed only fills the in-memory stores; a database is seeded with `npm run seed -w @code-sentinel/db`.
    message: "must be none when DATABASE_URL is set",
    path: ["GATEWAY_SEED"],
  })
  .refine((values) => values.NODE_ENV !== "production" || values.DATABASE_URL !== undefined, {
    message: "is required when NODE_ENV is production",
    path: ["DATABASE_URL"],
  })
  .refine((values) => values.NODE_ENV !== "production" || values.SUPABASE_URL !== undefined, {
    // Without it nobody can sign in to the dashboard.
    message: "is required when NODE_ENV is production",
    path: ["SUPABASE_URL"],
  })  .refine((values) => (values.GITHUB_APP_ID === undefined) === (values.GITHUB_PRIVATE_KEY_PATH === undefined), {
    message: "must be set together with GITHUB_PRIVATE_KEY_PATH",
    path: ["GITHUB_APP_ID"],
  })
  .refine(
    (values) => {
      const set = [values.GITHUB_APP_CLIENT_ID, values.GITHUB_APP_CLIENT_SECRET, values.FIELD_ENCRYPTION_KEY].filter((v) => v !== undefined);
      return set.length === 0 || set.length === 3;
    },
    { message: "must be set together with GITHUB_APP_CLIENT_SECRET and FIELD_ENCRYPTION_KEY", path: ["GITHUB_APP_CLIENT_ID"] },
  )
  .refine((values) => values.NODE_ENV !== "production" || values.GITHUB_APP_CLIENT_ID !== undefined, {
    // Without them nobody can connect a repository.
    message: "is required when NODE_ENV is production",
    path: ["GITHUB_APP_CLIENT_ID"],
  })
  .refine((values) => values.NODE_ENV !== "production" || values.GITHUB_APP_ID !== undefined, {
    // The stub client returns no files, so a deployed gateway would review nothing.
    message: "is required when NODE_ENV is production",
    path: ["GITHUB_APP_ID"],
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
  const config: GatewayConfig = {
    port: values.PORT,
    orchestratorUrl: values.ORCHESTRATOR_URL,
    orchestratorTimeoutMs: values.ORCHESTRATOR_TIMEOUT_MS,
    serviceToken: values.SERVICE_TOKEN,
    githubWebhookSecret: values.GITHUB_WEBHOOK_SECRET,
    seed: values.GATEWAY_SEED,
    reviewPollTimeoutMs: values.REVIEW_POLL_TIMEOUT_MS,
    mfaStepUpMinutes: values.MFA_STEP_UP_MINUTES,
    fileContentMaxBytes: values.FILE_CONTENT_MAX_BYTES,
  };
  if (values.DATABASE_URL !== undefined) config.databaseUrl = values.DATABASE_URL;
  if (values.SUPABASE_URL !== undefined) config.supabaseUrl = values.SUPABASE_URL.replace(/\/+$/, "");
  if (values.DASHBOARD_URL !== undefined) config.dashboardUrl = values.DASHBOARD_URL.replace(/\/+$/, "");
  if (values.GITHUB_APP_ID !== undefined && values.GITHUB_PRIVATE_KEY_PATH !== undefined) {
    config.githubApp = { appId: values.GITHUB_APP_ID, privateKeyPath: values.GITHUB_PRIVATE_KEY_PATH };
  }
  if (values.GITHUB_APP_CLIENT_ID && values.GITHUB_APP_CLIENT_SECRET && values.FIELD_ENCRYPTION_KEY) {
    config.githubLink = {
      clientId: values.GITHUB_APP_CLIENT_ID,
      clientSecret: values.GITHUB_APP_CLIENT_SECRET,
      fieldEncryptionKey: values.FIELD_ENCRYPTION_KEY,
    };
  }
  if (values.GATEWAY_DEV_REPOSITORY) {
    const [fullName, id] = values.GATEWAY_DEV_REPOSITORY.split(":") as [string, string];
    config.devRepository = { fullName, githubRepoId: Number(id) };
  }
  return config;
}
