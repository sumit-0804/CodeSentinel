import { z } from "zod";

import {
  AgentKindSchema,
  ChangedFileSchema,
  ConfidenceSchema,
  FindingSchema,
  LanguageSchema,
  SeveritySchema,
  SkippedFileSchema,
} from "./common.js";

/**
 * The agent service contract, implemented five times.
 * Mirrors `docs/design/openapi/agent.yaml`. Change the YAML first, then this file.
 */

export const AgentReviewOptionsSchema = z
  .object({
    /**
     * Time the agent has left before the orchestrator abandons the call. Past it the agent stops
     * starting new files and returns what it has, listing the rest as over_budget skips.
     */
    deadlineMs: z.number().int().min(0).optional(),
  })
  // Agent-specific switches (autoFix, includeDocstringDrafts, ...) pass through untouched.
  .passthrough();
export type AgentReviewOptions = z.infer<typeof AgentReviewOptionsSchema>;

export const AgentReviewRequestSchema = z.object({
  /** Correlation id only. The agent does not persist it. */
  reviewId: z.string().uuid(),
  /** Repository-level hint. Per-file language on each entry wins. */
  language: LanguageSchema.optional(),
  files: z.array(ChangedFileSchema).min(1).max(200),
  /** Passed for information; the threshold is applied by the orchestrator (FR-ORC-06). */
  confidenceThreshold: ConfidenceSchema.optional(),
  options: AgentReviewOptionsSchema.optional(),
});
export type AgentReviewRequest = z.infer<typeof AgentReviewRequestSchema>;

/** Absent for the Style Agent, which must make no LLM call at all (NFR-07). */
export const AgentLlmUsageSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  /** Always 0 since Gemini is the only provider; kept for the agent_runs column. */
  fallbackDepth: z.number().int().min(0).optional(),
  promptTokens: z.number().int().min(0).optional(),
  completionTokens: z.number().int().min(0).optional(),
});
export type AgentLlmUsage = z.infer<typeof AgentLlmUsageSchema>;

export const AgentReviewResponseSchema = z.object({
  reviewId: z.string().uuid(),
  agent: AgentKindSchema,
  serviceVersion: z.string().optional(),
  /** An empty array is a valid, successful result. */
  findings: z.array(FindingSchema),
  analyzedFileCount: z.number().int().min(0).optional(),
  skippedFiles: z.array(SkippedFileSchema).optional(),
  llm: AgentLlmUsageSchema.optional(),
  latencyMs: z.number().int().min(0).optional(),
});
export type AgentReviewResponse = z.infer<typeof AgentReviewResponseSchema>;

export const CapabilityRuleSchema = z.object({
  ruleId: z.string(),
  title: z.string().optional(),
  defaultSeverity: SeveritySchema,
});
export type CapabilityRule = z.infer<typeof CapabilityRuleSchema>;

export const CapabilitiesSchema = z.object({
  agent: AgentKindSchema,
  version: z.string(),
  languages: z.array(LanguageSchema),
  usesLlm: z.boolean().optional(),
  producesDeterministicFixes: z.boolean().optional(),
  /** Whole request body cap; larger requests get 413. */
  maxDiffBytes: z.number().int().min(0).optional(),
  /** Per-file limit in estimated tokens (~3 bytes each). A larger file is a too_large skip, never split. */
  maxFileTokens: z.number().int().min(0).optional(),
  rules: z.array(CapabilityRuleSchema).optional(),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

export const HealthStatusSchema = z.enum(["ok", "degraded", "unavailable"]);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const HealthSchema = z.object({
  status: HealthStatusSchema,
  version: z.string().optional(),
  /** Per-dependency state, e.g. { sandbox: "ok", llmProvider: "degraded" }. */
  checks: z.record(z.string()).optional(),
});
export type Health = z.infer<typeof HealthSchema>;
