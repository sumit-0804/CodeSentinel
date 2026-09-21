import { createLlmClient, LlmConfigError, loadLlmLimits, type LlmClient } from "@code-sentinel/llm";
import { z } from "zod";

export interface AgentEnv {
  port: number;
  /** Required on `POST /v1/review`; the same value the orchestrator sends. */
  serviceToken: string;
  /** Built from `GROQ_*` / `GEMINI_*`; absent when neither key is set. */
  llm?: LlmClient;
}

/** Thrown by `loadAgentEnv` with every invalid variable listed at once. */
export class AgentConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: string[]) {
    super(`Invalid agent configuration: ${problems.join("; ")}`);
    this.name = "AgentConfigError";
    this.problems = problems;
  }
}

const blankAsUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/** Reads `PORT`, `SERVICE_TOKEN` and, for LLM agents, the keys and limits from `@code-sentinel/llm`. */
export function loadAgentEnv(env: Record<string, string | undefined>, options: { defaultPort: number; usesLlm: boolean }): AgentEnv {
  const schema = z.object({
    PORT: z.preprocess(
      blankAsUndefined,
      z.coerce
        .number({ invalid_type_error: "must be an integer" })
        .int("must be an integer")
        .min(1, "must be between 1 and 65535")
        .max(65535, "must be between 1 and 65535")
        .default(options.defaultPort),
    ),
    SERVICE_TOKEN: z.preprocess(blankAsUndefined, z.string().min(1, "must not be empty")),
  });

  const problems: string[] = [];
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const missing = issue.code === "invalid_type" && issue.received === "undefined";
      problems.push(`${issue.path.join(".")} ${missing ? "is required" : issue.message}`);
    }
  }

  let llm: LlmClient | undefined;
  if (options.usesLlm) {
    try {
      llm = createLlmClient(loadLlmLimits(env));
    } catch (error) {
      if (!(error instanceof LlmConfigError)) throw error;
      problems.push(...error.problems);
    }
  }

  if (!parsed.success || problems.length) throw new AgentConfigError(problems);
  return { port: parsed.data.PORT, serviceToken: parsed.data.SERVICE_TOKEN, ...(llm ? { llm } : {}) };
}
