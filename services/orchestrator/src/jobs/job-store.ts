import type { ReviewJob, ReviewJobStatus } from "@code-sentinel/contracts";

const TERMINAL: ReadonlySet<ReviewJobStatus> = new Set(["completed", "partial", "failed", "cancelled"]);

export function isTerminal(status: ReviewJobStatus): boolean {
  return TERMINAL.has(status);
}

/** Where review jobs live. In memory for now; PostgreSQL (`ReviewRepository`) replaces it. */
export interface JobStore {
  get(jobId: string): ReviewJob | undefined;
  findByIdempotencyKey(key: string): ReviewJob | undefined;
  insert(job: ReviewJob, idempotencyKey?: string): void;
  /** Replaces the stored job with the same `jobId`. */
  update(job: ReviewJob): void;
}

export interface InMemoryJobStoreOptions {
  /** How long a finished job stays readable, from its `completedAt`. */
  retentionMs: number;
  now?: () => Date;
}

/** Jobs are stored as immutable snapshots, so a returned job never changes under the caller. */
export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, ReviewJob>();
  private readonly byKey = new Map<string, string>();
  private readonly keyOf = new Map<string, string>();
  private readonly retentionMs: number;
  private readonly now: () => Date;

  constructor(options: InMemoryJobStoreOptions) {
    this.retentionMs = options.retentionMs;
    this.now = options.now ?? (() => new Date());
  }

  get(jobId: string): ReviewJob | undefined {
    return this.jobs.get(jobId);
  }

  findByIdempotencyKey(key: string): ReviewJob | undefined {
    const jobId = this.byKey.get(key);
    return jobId === undefined ? undefined : this.jobs.get(jobId);
  }

  insert(job: ReviewJob, idempotencyKey?: string): void {
    // Sweeping on insert keeps memory bounded without a timer.
    this.sweep();
    this.jobs.set(job.jobId, job);
    if (idempotencyKey !== undefined) {
      this.byKey.set(idempotencyKey, job.jobId);
      this.keyOf.set(job.jobId, idempotencyKey);
    }
  }

  update(job: ReviewJob): void {
    if (!this.jobs.has(job.jobId)) throw new Error(`Unknown review job ${job.jobId}`);
    this.jobs.set(job.jobId, job);
  }

  private sweep(): void {
    const cutoff = this.now().getTime() - this.retentionMs;
    for (const [jobId, job] of this.jobs) {
      if (!isTerminal(job.status) || !job.completedAt || Date.parse(job.completedAt) > cutoff) continue;
      this.jobs.delete(jobId);
      const key = this.keyOf.get(jobId);
      if (key !== undefined) {
        this.byKey.delete(key);
        this.keyOf.delete(jobId);
      }
    }
  }
}
