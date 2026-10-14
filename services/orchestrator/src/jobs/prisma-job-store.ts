import { randomUUID } from "node:crypto";

import type { AgentKind, ApiError, CombinedReport, ReviewJob, ReviewJobRequest, ReviewJobStatus } from "@code-sentinel/contracts";
import { Prisma, type PrismaClient, type Review } from "@code-sentinel/db";

import { countChangedLines } from "../aggregation/coverage.js";
import { dedupeKey } from "../aggregation/finding-aggregator.js";
import { severityRank } from "../aggregation/severity-ranker.js";
import { agentBudgetMs } from "../budget/llm-routing.js";
import { DEFAULT_AGENT_TIMEOUT_MS, DEFAULT_CONFIDENCE_THRESHOLD } from "../graph/defaults.js";
import { ORPHANED_ERROR, pullRequestCommitKey, type InsertResult, type JobStore } from "./job-store.js";

const ACTIVE = ["queued", "running"] as const;

export interface PrismaJobStoreOptions {
  /** Set when an LLM provider is configured, so `agent_runs.timeout_ms` records the LLM agents' real budget. */
  llmAgentTimeoutMs?: number;
}

/**
 * Review jobs in the `reviews` table, with the full `CombinedReport` as JSON and, once finished, one
 * row per agent run, finding and suggestion. `reviews.id` is the job's `reviewId`.
 */
export class PrismaJobStore implements JobStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: PrismaJobStoreOptions = {},
  ) {}

  async get(jobId: string): Promise<ReviewJob | undefined> {
    const row = await this.prisma.review.findUnique({ where: { jobId } });
    return row ? toJob(row) : undefined;
  }

  async findByIdempotencyKey(key: string): Promise<ReviewJob | undefined> {
    const row = await this.prisma.review.findUnique({ where: { idempotencyKey: key } });
    return row ? toJob(row) : undefined;
  }

  async insert(job: ReviewJob, request: ReviewJobRequest, idempotencyKey?: string): Promise<InsertResult> {
    try {
      await this.prisma.review.create({
        data: {
          id: job.reviewId,
          jobId: job.jobId,
          idempotencyKey: idempotencyKey ?? null,
          organizationId: request.organizationId,
          repositoryId: request.repositoryId,
          trigger: request.trigger,
          triggeredByUserId: request.triggeredByUserId ?? null,
          prNumber: request.pullRequest?.number ?? null,
          prTitle: request.pullRequest?.title ?? null,
          headRef: request.pullRequest?.headRef ?? null,
          baseRef: request.pullRequest?.baseRef ?? null,
          headSha: request.headSha,
          baseSha: request.baseSha ?? null,
          changedFilesCount: request.files.length + (request.skippedFiles?.length ?? 0),
          changedLinesCount: request.files.reduce((total, file) => total + countChangedLines(file.patch), 0),
          status: "queued",
          confidenceThreshold: request.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
          createdAt: new Date(job.createdAt),
        },
      });
      return { job, created: true };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      // Lost a race on the idempotency key, or this pull request commit already has a review.
      const existing = await this.findExisting(request, idempotencyKey);
      if (!existing) throw error;
      return { job: existing, created: false };
    }
  }

  async markRunning(jobId: string, startedAt: string): Promise<void> {
    const { count } = await this.prisma.review.updateMany({
      where: { jobId, status: { in: [...ACTIVE] } },
      data: { status: "running", startedAt: new Date(startedAt) },
    });
    if (count === 0 && !(await this.prisma.review.findUnique({ where: { jobId }, select: { id: true } }))) {
      throw new Error(`Unknown review job ${jobId}`);
    }
  }

  async complete(job: ReviewJob, request?: ReviewJobRequest): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // The status guard makes cancel and finish race-free: whichever writes first wins.
      const { count } = await tx.review.updateMany({
        where: { jobId: job.jobId, status: { in: [...ACTIVE] } },
        data: {
          status: job.status,
          ...(job.startedAt ? { startedAt: new Date(job.startedAt) } : {}),
          ...(job.completedAt ? { completedAt: new Date(job.completedAt) } : {}),
          durationMs: job.report?.durationMs ?? elapsedMs(job.startedAt, job.completedAt),
          ...(job.report ? { report: job.report as unknown as Prisma.InputJsonValue } : {}),
          ...(job.error ? { error: job.error as unknown as Prisma.InputJsonValue, errorMessage: job.error.message } : {}),
        },
      });
      if (count === 0) return false;
      if (job.report) {
        await this.writeReportRows(tx, job.reviewId, job.report, request, job.completedAt);
        await supersedeOlderSuggestions(tx, job.reviewId);
      }
      return true;
    });
  }

  async failOrphaned(completedAt: string): Promise<number> {
    const { count } = await this.prisma.review.updateMany({
      where: { status: { in: [...ACTIVE] } },
      data: {
        status: "failed",
        completedAt: new Date(completedAt),
        error: ORPHANED_ERROR as unknown as Prisma.InputJsonValue,
        errorMessage: ORPHANED_ERROR.message,
      },
    });
    return count;
  }

  private async findExisting(request: ReviewJobRequest, idempotencyKey?: string): Promise<ReviewJob | undefined> {
    if (idempotencyKey !== undefined) {
      const byKey = await this.findByIdempotencyKey(idempotencyKey);
      if (byKey) return byKey;
    }
    if (pullRequestCommitKey(request) === undefined) return undefined;
    const row = await this.prisma.review.findFirst({
      where: {
        repositoryId: request.repositoryId,
        prNumber: request.pullRequest?.number ?? null,
        headSha: request.headSha,
        trigger: "github_pull_request",
      },
    });
    return row ? toJob(row) : undefined;
  }

  /** `agent_runs`, `findings` and `suggestions` for history and filters; the report JSON stays the API's source. */
  private async writeReportRows(
    tx: Prisma.TransactionClient,
    reviewId: string,
    report: CombinedReport,
    request: ReviewJobRequest | undefined,
    completedAt: string | undefined,
  ): Promise<void> {
    const runIds = new Map<AgentKind, string>();
    const finishedAt = completedAt ? new Date(completedAt) : null;
    await tx.agentRun.createMany({
      data: report.agentRuns.map((run) => {
        const id = randomUUID();
        runIds.set(run.agent, id);
        return {
          id,
          reviewId,
          agent: run.agent,
          status: run.status,
          llmProvider: run.llmProvider ?? null,
          findingsCount: run.findingsCount ?? 0,
          latencyMs: run.latencyMs ?? null,
          timeoutMs: agentBudgetMs(run.agent, request?.agentTimeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS, this.options.llmAgentTimeoutMs),
          errorCode: run.errorCode ?? null,
          finishedAt,
        };
      }),
    });

    const findings = report.findings.map((finding) => {
      const agentRunId = runIds.get(finding.agent);
      if (!agentRunId) throw new Error(`Finding from ${finding.agent} has no agent run in review ${reviewId}`);
      return { id: randomUUID(), agentRunId, finding };
    });
    await tx.finding.createMany({
      data: findings.map(({ id, agentRunId, finding }) => ({
        id,
        reviewId,
        agentRunId,
        agent: finding.agent,
        ruleId: finding.ruleId,
        title: finding.title,
        description: finding.description,
        filePath: finding.location.filePath,
        lineStart: finding.location.lineStart,
        lineEnd: finding.location.lineEnd,
        severity: finding.severity,
        confidence: finding.confidence,
        severityRank: severityRank(finding.severity),
        cweId: finding.cweId ?? null,
        dedupeKey: dedupeKey(finding),
        duplicateCount: finding.duplicateCount ?? 1,
      })),
    });

    // Every suggestion starts proposed; accept and reject are recorded later (UC-3).
    await tx.suggestion.createMany({
      data: findings.flatMap(({ id, finding }) =>
        finding.suggestion
          ? [
              {
                findingId: id,
                kind: finding.suggestion.kind,
                state: "proposed" as const,
                originalSnippet: finding.suggestion.originalSnippet,
                suggestedSnippet: finding.suggestion.suggestedSnippet,
                explanation: finding.suggestion.explanation ?? null,
              },
            ]
          : [],
      ),
    });
  }
}

/**
 * A finished review replaces the fixes older reviews of the same pull request proposed (UC-3): the
 * ones nobody accepted or rejected become `superseded`, which also covers fixes committed on GitHub.
 */
async function supersedeOlderSuggestions(tx: Prisma.TransactionClient, reviewId: string): Promise<void> {
  const review = await tx.review.findUnique({ where: { id: reviewId }, select: { repositoryId: true, prNumber: true, createdAt: true } });
  if (!review || review.prNumber === null) return;
  await tx.suggestion.updateMany({
    where: {
      state: "proposed",
      finding: { review: { repositoryId: review.repositoryId, prNumber: review.prNumber, createdAt: { lt: review.createdAt }, id: { not: reviewId } } },
    },
    data: { state: "superseded" },
  });
}

/** The graph does not always set `report.durationMs`; the job's own timestamps give the same figure. */
function elapsedMs(startedAt: string | undefined, completedAt: string | undefined): number | null {
  if (!startedAt || !completedAt) return null;
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

function toJob(row: Review): ReviewJob {
  const report = row.report as CombinedReport | null;
  return {
    jobId: row.jobId ?? row.id,
    reviewId: row.id,
    status: row.status as ReviewJobStatus,
    createdAt: row.createdAt.toISOString(),
    ...(row.startedAt ? { startedAt: row.startedAt.toISOString() } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
    ...(report ? { agentRuns: report.agentRuns, report } : {}),
    ...(row.error ? { error: row.error as unknown as ApiError } : {}),
  };
}
