import type { ReviewAgent } from "@code-sentinel/agent-kit";
import { HttpError } from "@code-sentinel/service-kit";

import { fragmentFindings } from "./findings.js";
import { buildFragments } from "./fragments.js";
import { isAbort, type Sandbox } from "./sandbox.js";

/**
 * The Style Agent (FR-STY-01..04, NFR-07): ESLint + Prettier for JavaScript/TypeScript and Ruff +
 * Black for Python, all inside one sandbox container per request. It makes no LLM call, so its
 * fixes are deterministic and safe to apply without review.
 */
export function createStyleAgent(sandbox: Sandbox): ReviewAgent {
  return {
    kind: "style",
    version: "1.0.0",
    languages: ["javascript", "typescript", "python"],
    usesLlm: false,
    producesDeterministicFixes: true,
    maxDiffBytes: 5_000_000,
    maxFileTokens: 50_000,

    async analyze(files, context) {
      const fragments = buildFragments(files);
      if (!fragments.length) return { findings: [] };

      let result;
      try {
        result = await sandbox.run(
          fragments.map((fragment) => fragment.sandboxFile),
          context.signal,
        );
      } catch (error) {
        if (isAbort(error)) {
          context.logger.warn("sandbox stopped at the deadline", {});
          return { findings: [], skipped: files.map((file) => ({ path: file.path, reason: "over_budget" as const })) };
        }
        context.logger.error("sandbox run failed", { error });
        throw new HttpError(503, "sandbox_unavailable", "The style sandbox could not run");
      }

      const findings = fragments.flatMap((fragment) => fragmentFindings(fragment, result.files[fragment.sandboxFile.name]));
      const unparsed = fragments.filter((fragment) => result.files[fragment.sandboxFile.name]?.parseError).length;
      if (unparsed) context.logger.info("hunks left out: they do not parse on their own", { unparsed, total: fragments.length });
      return { findings };
    },

    async health() {
      return { sandbox: await sandbox.health() };
    },
  };
}
