import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

export type Env = Record<string, string | undefined>;

/** `.env.production` when `NODE_ENV=production`, otherwise `.env`. */
export function envFileName(nodeEnv: string | undefined): string {
  return nodeEnv === "production" ? ".env.production" : ".env";
}

/** Merges the env file from `dir` under `env`; real variables win, and a missing file is not an error. */
export function loadEnvFile(dir: string, env: Env = process.env): { env: Env; file?: string } {
  const file = join(dir, envFileName(env.NODE_ENV));
  if (!existsSync(file)) return { env: { ...env } };
  return { env: { ...parseEnv(readFileSync(file, "utf8")), ...env }, file };
}
