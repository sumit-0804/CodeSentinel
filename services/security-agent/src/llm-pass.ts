import type { AgentLlmUsage, ChangedFile } from "@code-sentinel/contracts";
import { parsePatch, type AgentContext } from "@code-sentinel/agent-kit";
import { LlmProviderError, type JsonSchema, type LlmRequest } from "@code-sentinel/llm";
import { z } from "zod";

import type { SecurityFinding } from "./scan.js";
import { maskSecrets } from "./secrets.js";

const SYSTEM_PROMPT = `You are the Security Agent of an automated code review.
You see only the changed hunks of a pull request. Lines marked "+" were added; lines marked " " are unchanged context.
Report security vulnerabilities introduced by the ADDED lines only: injection (SQL, command, code, LDAP, template),
XSS, insecure deserialization, path traversal, SSRF, broken authentication or authorization, weak cryptography,
insecure randomness for secrets, sensitive data exposure, and unsafe file or network handling.
Do not report style, performance or general bugs. Do not report issues you are unsure about.
Secrets in the input are already masked as "****"; do not report masked values.
For each issue give the file path and the new-side line numbers exactly as shown, a severity
(critical, warning or info), a confidence between 0 and 1, and a CWE id such as "CWE-89" (empty string if none).
Use a ruleId of the form "security/<kebab-case-name>". Return {"findings": []} when there is nothing to report.`;

/** Groq strict mode: every property required, every object closed. */
const RESPONSE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ruleId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          filePath: { type: "string" },
          lineStart: { type: "integer" },
          lineEnd: { type: "integer" },
          severity: { type: "string", enum: ["critical", "warning", "info"] },
          confidence: { type: "number" },
          cweId: { type: "string" },
        },
        required: ["ruleId", "title", "description", "filePath", "lineStart", "lineEnd", "severity", "confidence", "cweId"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};

/** The model's answer is untrusted: validated again here, whatever the provider promised. */
const LlmAnswerSchema = z.object({
  findings: z.array(
    z.object({
      ruleId: z.string().min(1).max(100),
      title: z.string().min(1).max(200),
      description: z.string().min(1).max(2000),
      filePath: z.string(),
      lineStart: z.number().int(),
      lineEnd: z.number().int(),
      severity: z.enum(["critical", "warning", "info"]),
      confidence: z.number(),
      cweId: z.string(),
    }),
  ),
});

const CWE = /^CWE-\d{1,5}$/;
/** Longest span one finding may cover; anything wider is clipped. */
const MAX_SPAN = 20;

export interface LlmPassResult {
  findings: SecurityFinding[];
  llm?: AgentLlmUsage;
}

/** Each file's hunks with new-side line numbers, secrets masked, as the model sees them. */
export function buildPrompt(files: ChangedFile[]): string {
  const sections = files.map((file) => {
    const hunks = parsePatch(file.patch).hunks.map((hunk) =>
      hunk.lines.map((line) => `${String(line.line).padStart(5)} ${line.added ? "+" : " "} ${maskSecrets(line.text)}`).join("\n"),
    );
    return `### File: ${file.path} (${file.language})\n${hunks.join("\n   ...\n")}`;
  });
  return `Review these changes for security vulnerabilities.\n\n${sections.join("\n\n")}`;
}

/**
 * One LLM call for the whole request on the provider the orchestrator reserved. A failure never
 * fails the review: the rule findings still stand, and the error is logged.
 */
export async function runLlmPass(files: ChangedFile[], context: AgentContext): Promise<LlmPassResult> {
  if (!context.llm) return { findings: [] };

  const request: LlmRequest = {
    systemPrompt: SYSTEM_PROMPT,
    prompt: buildPrompt(files),
    schemaName: "security_findings",
    responseSchema: RESPONSE_SCHEMA,
  };

  let answer;
  try {
    answer = await context.llm.client.complete(request, {
      provider: context.llm.provider,
      signal: context.signal,
      ...(Number.isFinite(context.deadlineAt) ? { deadlineAt: context.deadlineAt } : {}),
    });
  } catch (error) {
    const fields = error instanceof LlmProviderError ? { provider: error.provider, kind: error.kind, status: error.status } : {};
    context.logger.warn("llm pass failed; returning rule findings only", { ...fields, error });
    return { findings: [] };
  }

  const llm: AgentLlmUsage = {
    provider: answer.provider,
    model: answer.model,
    fallbackDepth: answer.fallbackDepth,
    promptTokens: answer.promptTokens,
    completionTokens: answer.completionTokens,
  };

  let parsed;
  try {
    parsed = LlmAnswerSchema.parse(JSON.parse(answer.text));
  } catch (error) {
    context.logger.warn("llm answer did not match the schema; ignored", { provider: answer.provider, error });
    return { findings: [], llm };
  }

  const added = new Map(files.map((file) => [file.path, new Set(parsePatch(file.patch).addedLines.map((line) => line.line))]));
  const findings: SecurityFinding[] = [];
  let dropped = 0;
  for (const item of parsed.findings) {
    const lines = added.get(item.filePath);
    if (!lines?.has(item.lineStart)) {
      dropped++;
      continue;
    }
    findings.push({
      ruleId: item.ruleId.startsWith("security/") ? item.ruleId : `security/${item.ruleId}`,
      title: item.title,
      description: maskSecrets(item.description),
      location: {
        filePath: item.filePath,
        lineStart: item.lineStart,
        lineEnd: Math.min(Math.max(item.lineEnd, item.lineStart), item.lineStart + MAX_SPAN),
      },
      severity: item.severity,
      confidence: Math.min(1, Math.max(0, item.confidence)),
      ...(CWE.test(item.cweId) ? { cweId: item.cweId } : {}),
    });
  }
  // A finding must sit on a line this PR added; anything else is a hallucination or old code.
  if (dropped) context.logger.info("llm findings dropped: not on an added line", { dropped });
  return { findings, llm };
}
