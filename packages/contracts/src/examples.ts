import type { AgentReviewRequest, AgentReviewResponse } from "./agent.js";
import type { ChangedFile, CombinedReport, Finding } from "./common.js";
import type { ReviewJobRequest } from "./orchestrator.js";

/**
 * Valid example payloads, lifted from the `example` blocks in `docs/design/openapi/*.yaml`.
 * Import from `@code-sentinel/contracts/examples` in tests instead of copying literals.
 */

export const EXAMPLE_REVIEW_ID = "8f1c3a92-4c1e-4c22-9a0e-6f2f4b9d0a11";
export const EXAMPLE_REPOSITORY_ID = "2b0c6b0e-0b1a-4f6e-9c3d-1a2b3c4d5e6f";
export const EXAMPLE_ORGANIZATION_ID = "7d9e1f2a-3b4c-4d5e-8f60-718293a4b5c6";

/** The `pythonDiff` example from `agent.yaml`. */
export const exampleChangedFile: ChangedFile = {
  path: "payments/retry_queue.py",
  language: "python",
  changeType: "modified",
  patch:
    '@@ -128,6 +128,11 @@\n+    conn = psycopg2.connect(DSN)\n+    cur = conn.cursor()\n+    cur.execute(f"SELECT * FROM payments WHERE id = {payment_id}")\n',
};

export const exampleFinding: Finding = {
  agent: "security",
  ruleId: "security/sql-injection",
  title: "SQL built from an f-string",
  description: "payment_id is interpolated straight into the query; use a parameterised query.",
  location: { filePath: "payments/retry_queue.py", lineStart: 132, lineEnd: 132 },
  severity: "critical",
  confidence: 0.92,
  cweId: "CWE-89",
  suggestion: {
    kind: "ai_suggested",
    originalSnippet: 'cur.execute(f"SELECT * FROM payments WHERE id = {payment_id}")',
    suggestedSnippet: 'cur.execute("SELECT * FROM payments WHERE id = %s", (payment_id,))',
    explanation: "Parameters are passed separately, so the driver escapes them.",
  },
};

export const exampleAgentReviewRequest: AgentReviewRequest = {
  reviewId: EXAMPLE_REVIEW_ID,
  language: "python",
  confidenceThreshold: 0.8,
  files: [exampleChangedFile],
  options: { autoFix: true, includeDocstringDrafts: true, deadlineMs: 18000 },
};

export const exampleAgentReviewResponse: AgentReviewResponse = {
  reviewId: EXAMPLE_REVIEW_ID,
  agent: "security",
  serviceVersion: "1.0.0",
  findings: [exampleFinding],
  analyzedFileCount: 1,
  skippedFiles: [],
  llm: {
    provider: "gemini",
    model: "gemini-3.5-flash-lite",
    fallbackDepth: 0,
    promptTokens: 1420,
    completionTokens: 310,
  },
  latencyMs: 2350,
};

export const exampleReviewJobRequest: ReviewJobRequest = {
  repositoryId: EXAMPLE_REPOSITORY_ID,
  organizationId: EXAMPLE_ORGANIZATION_ID,
  trigger: "github_pull_request",
  pullRequest: { number: 42, title: "Retry failed payments", headRef: "fix/retry", baseRef: "main" },
  headSha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  baseSha: "0123456789abcdef0123456789abcdef01234567",
  files: [exampleChangedFile],
  skippedFiles: [{ path: "package-lock.json", reason: "generated_file" }],
  enabledAgents: ["security", "style", "logic"],
  confidenceThreshold: 0.8,
  agentTimeoutMs: 20000,
  includeSimilarPastIssues: true,
};

export const exampleCombinedReport: CombinedReport = {
  reviewId: EXAMPLE_REVIEW_ID,
  status: "partial",
  repositoryFullName: "code-sentinel/consumer-api",
  pullRequestNumber: 42,
  headSha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  confidenceThreshold: 0.8,
  summary: {
    criticalCount: 1,
    warningCount: 0,
    infoCount: 0,
    autoFixedCount: 0,
    suggestedFixCount: 1,
  },
  findings: [{ ...exampleFinding, duplicateCount: 2 }],
  agentRuns: [
    { agent: "security", status: "succeeded", findingsCount: 1, latencyMs: 2350, llmProvider: "gemini" },
    { agent: "style", status: "succeeded", findingsCount: 0, latencyMs: 1420 },
    { agent: "logic", status: "timed_out", latencyMs: 20000, llmProvider: "gemini" },
  ],
  skippedFiles: [{ path: "package-lock.json", reason: "generated_file" }],
  coverage: { filesTotal: 2, filesReviewed: 1, changedLinesTotal: 3, changedLinesReviewed: 3 },
  durationMs: 20410,
  completedAt: "2026-09-15T10:30:00Z",
};
