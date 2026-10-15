import type { AgentLlmUsage, ChangedFile, Finding, OtherChange, Suggestion } from "@code-sentinel/contracts";
import { LlmProviderError, type JsonSchema, type LlmRequest } from "@code-sentinel/llm";
import { z } from "zod";

import type { AgentContext } from "./agent.js";
import { parsePatch } from "./patch.js";

export type LlmFinding = Omit<Finding, "agent">;

export interface LlmPassOptions {
  /** What this agent looks for and what it must leave to the others; the input format is added here. */
  systemPrompt: string;
  /** The prompt's first line, e.g. "Review these changes for security vulnerabilities." */
  task: string;
  /** Names the JSON schema for the provider, e.g. `security_findings`. */
  schemaName: string;
  /** Every `ruleId` gets this prefix, e.g. `security/`. */
  rulePrefix: string;
  /** Agent name in a fix's explanation, e.g. "Security". */
  agentName: string;
  /** Keep the model's CWE id; agents without CWE mapping leave it off. */
  allowCwe: boolean;
  /** Applied to every line sent and every description returned, e.g. secret masking. */
  mask?: (text: string) => string;
  /**
   * LLM-only agents: no provider, a failed call or an unreadable answer throws `LlmPassError`, so the
   * run fails instead of passing clean. Otherwise those cases return no findings and are logged.
   */
  required?: boolean;
}

export interface LlmPassResult {
  findings: LlmFinding[];
  llm?: AgentLlmUsage;
}

/** A required LLM pass could not produce an answer; the agent answers 503 `llm_failed`. */
export class LlmPassError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmPassError";
  }
}

const FORMAT_RULES = `Input format:
Each file starts with "### File: <path> (<language>)". When the whole file is given, every line is printed as
"<line number> <mark> <code>", where the mark is "+" for a line this pull request added and " " for an unchanged
line. When only hunks are given, they are separated by "...". Read the whole file to understand the change, but
report only problems on ADDED lines ("+"): never on unchanged code.
A section "Other changes in this pull request" may follow: diffs of files reviewed in a separate call. Use them to
understand linked changes (a changed return value, a renamed field), but never report findings on those files.
Output:
lineStart must be the number printed on the line that contains the problem itself. For each issue give the file
path, lineStart and lineEnd, a severity (critical, warning or info), a confidence between 0 and 1, and a CWE id
such as "CWE-476" (empty string if none). Use a ruleId of the form "<prefix><kebab-case-name>".
suggestedCode is the complete replacement for lines lineStart..lineEnd with the problem fixed, keeping the
original indentation and nothing else changed; use "" when no safe local fix exists.
Do not report issues you are unsure about. Return {"findings": []} when there is nothing to report.`;

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
          suggestedCode: { type: "string" },
        },
        required: ["ruleId", "title", "description", "filePath", "lineStart", "lineEnd", "severity", "confidence", "cweId", "suggestedCode"],
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
      suggestedCode: z.string().max(4000).default(""),
    }),
  ),
});

const CWE = /^CWE-\d{1,5}$/;
/** Longest span one finding may cover; anything wider is clipped. */
const MAX_SPAN = 20;
const identity = (text: string) => text;

/**
 * Each file as the model sees it: the whole file with added lines marked when the gateway sent it,
 * else its hunks; then the pull request's other changes as context.
 */
export function buildLlmPrompt(task: string, files: ChangedFile[], otherChanges: OtherChange[] = [], mask: (text: string) => string = identity): string {
  const sections = files.map((file) => {
    const header = `### File: ${file.path} (${file.language})`;
    if (file.content !== undefined) {
      const added = new Set(parsePatch(file.patch).addedLines.map((line) => line.line));
      const lines = file.content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
      return `${header}\n${lines.map((text, i) => `${String(i + 1).padStart(5)} ${added.has(i + 1) ? "+" : " "} ${mask(text)}`).join("\n")}`;
    }
    const hunks = parsePatch(file.patch).hunks.map((hunk) =>
      hunk.lines.map((line) => `${String(line.line).padStart(5)} ${line.added ? "+" : " "} ${mask(line.text)}`).join("\n"),
    );
    return `${header}\n${hunks.join("\n   ...\n")}`;
  });
  const prompt = `${task}\n\n${sections.join("\n\n")}`;
  if (otherChanges.length === 0) return prompt;
  const others = otherChanges.map((change) =>
    change.patch === undefined ? `### ${change.path} (${change.changeType}; diff not shown)` : `### ${change.path} (${change.changeType})\n${mask(change.patch).replace(/\n$/, "")}`,
  );
  return `${prompt}\n\n## Other changes in this pull request (context only; do not report on them)\n\n${others.join("\n\n")}`;
}

/**
 * The model's fix as a GitHub "suggested change" (FR-GH-03), kept only when it replaces lines this PR
 * added (never unchanged code), actually changes them, and carries no masked secret, which would
 * commit a broken line. The author still has to accept it (FR-GH-04).
 */
function aiSuggestion(addedLines: Map<number, string>, lineStart: number, lineEnd: number, code: string, agentName: string): Suggestion | undefined {
  const replacement = code.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  if (!replacement.trim() || replacement.includes("****")) return undefined;

  const original: string[] = [];
  for (let line = lineStart; line <= lineEnd; line++) {
    const text = addedLines.get(line);
    if (text === undefined) return undefined;
    original.push(text);
  }
  const originalSnippet = original.join("\n");
  if (replacement === originalSnippet) return undefined;
  return { kind: "ai_suggested", originalSnippet, suggestedSnippet: replacement, explanation: `Suggested by the ${agentName} Agent's LLM pass; review before committing.` };
}

/** One LLM call for the whole request on the provider the orchestrator reserved. */
export async function runLlmPass(files: ChangedFile[], context: AgentContext, options: LlmPassOptions): Promise<LlmPassResult> {
  const mask = options.mask ?? identity;
  const fail = (message: string, fields: Record<string, unknown>, error?: unknown): LlmPassResult => {
    if (options.required) throw new LlmPassError(message, { cause: error });
    context.logger.warn(`${message}; returning rule findings only`, { ...fields, ...(error ? { error } : {}) });
    return { findings: [] };
  };
  if (!context.llm) return fail("no LLM provider was reserved for this request", {});

  const request: LlmRequest = {
    systemPrompt: `${options.systemPrompt}\n\n${FORMAT_RULES.replace("<prefix>", options.rulePrefix)}`,
    prompt: buildLlmPrompt(options.task, files, context.otherChanges, mask),
    schemaName: options.schemaName,
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
    return fail("llm pass failed", fields, error);
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
    if (options.required) throw new LlmPassError("llm answer did not match the schema", { cause: error });
    context.logger.warn("llm answer did not match the schema; ignored", { provider: answer.provider, error });
    return { findings: [], llm };
  }

  const added = new Map(files.map((file) => [file.path, new Map(parsePatch(file.patch).addedLines.map((line) => [line.line, line.text]))]));
  const findings: LlmFinding[] = [];
  let dropped = 0;
  for (const item of parsed.findings) {
    const lines = added.get(item.filePath);
    if (!lines?.has(item.lineStart)) {
      dropped++;
      continue;
    }
    const lineEnd = Math.min(Math.max(item.lineEnd, item.lineStart), item.lineStart + MAX_SPAN);
    const suggestion = aiSuggestion(lines, item.lineStart, lineEnd, item.suggestedCode, options.agentName);
    findings.push({
      ruleId: item.ruleId.startsWith(options.rulePrefix) ? item.ruleId : `${options.rulePrefix}${item.ruleId}`,
      title: item.title,
      description: mask(item.description),
      location: { filePath: item.filePath, lineStart: item.lineStart, lineEnd },
      severity: item.severity,
      confidence: Math.min(1, Math.max(0, item.confidence)),
      ...(options.allowCwe && CWE.test(item.cweId) ? { cweId: item.cweId } : {}),
      ...(suggestion ? { suggestion } : {}),
    });
  }
  // A finding must sit on a line this PR added; anything else is a hallucination, old code or another file.
  if (dropped) context.logger.info("llm findings dropped: not on an added line", { dropped });
  return { findings, llm };
}

/** An LLM's line numbers can drift a little (seen live: off by 2), so nearby counts as the same issue. */
const DUPLICATE_LINES = 3;

/**
 * Merges an agent's rule findings with its LLM findings: an LLM finding on the same issue (same
 * file, same `key`, within a few lines) is dropped, but its fix moves to the rule finding when the
 * fix's lines cover the rule's line.
 */
export function mergeRuleAndLlmFindings<F extends LlmFinding>(rules: F[], llm: F[], key: (finding: F) => string): F[] {
  const merged = rules.map((finding) => ({ ...finding }));
  const extra: F[] = [];
  for (const finding of llm) {
    const duplicate = merged.some(
      (rule) =>
        rule.location.filePath === finding.location.filePath &&
        key(rule) === key(finding) &&
        Math.abs(rule.location.lineStart - finding.location.lineStart) <= DUPLICATE_LINES,
    );
    if (!duplicate) {
      extra.push(finding);
      continue;
    }
    if (!finding.suggestion) continue;
    const { filePath, lineStart, lineEnd } = finding.location;
    const rule = merged.find(
      (candidate) =>
        !candidate.suggestion &&
        candidate.location.filePath === filePath &&
        candidate.location.lineStart >= lineStart &&
        candidate.location.lineStart <= lineEnd &&
        key(candidate) === key(finding),
    );
    if (rule) {
      rule.suggestion = finding.suggestion;
      rule.location = { ...finding.location };
    }
  }
  return [...merged, ...extra];
}
