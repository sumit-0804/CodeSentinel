import type { AgentRunSummary, ApiError, ReviewJob, ReviewJobRequest, ReviewJobStatus } from "@code-sentinel/contracts";

const TERMINAL: ReadonlySet<ReviewJobStatus> = new Set(["completed", "partial", "failed", "cancelled"]);

export function isTerminal(status: ReviewJobStatus): boolean {
  return TERMINAL.has(status);
}

/** Set on jobs a previous process left queued or running; they can never finish. */
export const ORPHANED_ERROR: ApiError = {
  code: "orchestrator_restarted",
  message: "The orchestrator restarted before this review finished",
};

export interface InsertResult {
  job: ReviewJob;
  /** `false` when the idempotency key or the pull request commit already had a job, which is returned instead. */
  created: boolean;
}

/** Where review jobs live: `InMemoryJobStore`, or `PrismaJobStore` when `DATABASE_URL` is set. */
export interface JobStore {
  get(jobId: string): Promise<ReviewJob | undefined>;
  findByIdempotencyKey(key: string): Promise<ReviewJob | undefined>;
  /** One GitHub review per repository, pull request and head commit, as `uq_reviews_pr_head` requires. */
  insert(job: ReviewJob, request: ReviewJobRequest, idempotencyKey?: string): Promise<InsertResult>;
  markRunning(jobId: string, startedAt: string): Promise<void>;
  /** Adds an agent that has answered to a running job's `agentRuns`; ignored once the job is finished. */
  recordAgentRun(jobId: string, run: AgentRunSummary): Promise<void>;
  /**
   * Writes a terminal job only while the stored one is still queued or running; `false` otherwise.
   * `request` (the job's own) lets a database store record each agent's time budget.
   */
  complete(job: ReviewJob, request?: ReviewJobRequest): Promise<boolean>;
  /** Fails every queued or running job; called once at startup, before any new job exists. */
  failOrphaned(completedAt: string): Promise<number>;
}

/** The commit a pull request review is unique on, or undefined for other triggers. */
export function pullRequestCommitKey(request: ReviewJobRequest): string | undefined {
  if (request.trigger !== "github_pull_request" || request.pullRequest?.number === undefined) return undefined;
  return `${request.repositoryId}:${request.pullRequest.number}:${request.headSha}`;
}

export interface InMemoryJobStoreOptions {
  /** How long a finished job stays readable, from its `completedAt`. */
  retentionMs: number;
  now?: () => Date;
}

/** Jobs are stored as immutable snapshots, so a returned job never changes under the caller. */
export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, ReviewJob>();
  /** Idempotency key or pull request commit key → job id. */
  private readonly byKey = new Map<string, string>();
  private readonly keysOf = new Map<string, string[]>();
  private readonly retentionMs: number;
  private readonly now: () => Date;

  constructor(options: InMemoryJobStoreOptions) {
    this.retentionMs = options.retentionMs;
    this.now = options.now ?? (() => new Date());
  }

  async get(jobId: string): Promise<ReviewJob | undefined> {
    return this.jobs.get(jobId);
  }

  async findByIdempotencyKey(key: string): Promise<ReviewJob | undefined> {
    return this.lookup(`idem:${key}`);
  }

  async insert(job: ReviewJob, request: ReviewJobRequest, idempotencyKey?: string): Promise<InsertResult> {
    // Sweeping on insert keeps memory bounded without a timer.
    this.sweep();
    const commit = pullRequestCommitKey(request);
    const keys = [
      ...(idempotencyKey !== undefined ? [`idem:${idempotencyKey}`] : []),
      ...(commit !== undefined ? [`commit:${commit}`] : []),
    ];
    for (const key of keys) {
      const existing = this.lookup(key);
      if (existing) return { job: existing, created: false };
    }

    this.jobs.set(job.jobId, job);
    for (const key of keys) this.byKey.set(key, job.jobId);
    this.keysOf.set(job.jobId, keys);
    return { job, created: true };
  }

  async markRunning(jobId: string, startedAt: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Unknown review job ${jobId}`);
    if (!isTerminal(job.status)) this.jobs.set(jobId, { ...job, status: "running", startedAt });
  }

  async recordAgentRun(jobId: string, run: AgentRunSummary): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job?.status === "running") this.jobs.set(jobId, { ...job, agentRuns: [...(job.agentRuns ?? []), run] });
  }

  async complete(job: ReviewJob): Promise<boolean> {
    const current = this.jobs.get(job.jobId);
    if (!current || isTerminal(current.status)) return false;
    this.jobs.set(job.jobId, job);
    return true;
  }

  async failOrphaned(completedAt: string): Promise<number> {
    let count = 0;
    for (const [jobId, job] of this.jobs) {
      if (isTerminal(job.status)) continue;
      this.jobs.set(jobId, { ...job, status: "failed", completedAt, error: ORPHANED_ERROR });
      count++;
    }
    return count;
  }

  private lookup(key: string): ReviewJob | undefined {
    const jobId = this.byKey.get(key);
    return jobId === undefined ? undefined : this.jobs.get(jobId);
  }

  private sweep(): void {
    const cutoff = this.now().getTime() - this.retentionMs;
    for (const [jobId, job] of this.jobs) {
      if (!isTerminal(job.status) || !job.completedAt || Date.parse(job.completedAt) > cutoff) continue;
      this.jobs.delete(jobId);
      for (const key of this.keysOf.get(jobId) ?? []) this.byKey.delete(key);
      this.keysOf.delete(jobId);
    }
  }
}
