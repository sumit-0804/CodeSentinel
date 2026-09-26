import type {
  CheckConclusion,
  CheckRunOutput,
  GitHubClient,
  PullRequestFile,
  PullRequestRef,
  ReviewComment,
} from "./github-client.js";

export interface RecordedCheckRun {
  id: number;
  ref: PullRequestRef;
  name: string;
  headSha: string;
  status: "in_progress" | "completed";
  conclusion?: CheckConclusion;
  output?: CheckRunOutput;
}

export interface RecordedReview {
  ref: PullRequestRef;
  commitId: string;
  body: string;
  comments: ReviewComment[];
}

/**
 * Returns the same files for every pull request and records every call, including Check Runs and
 * reviews. For tests and `GATEWAY_SEED=dev` without a GitHub App: nothing leaves the process.
 */
export class StubGitHubClient implements GitHubClient {
  readonly calls: PullRequestRef[] = [];
  readonly checkRuns: RecordedCheckRun[] = [];
  readonly reviews: RecordedReview[] = [];
  private readonly files: PullRequestFile[];

  constructor(files: PullRequestFile[] = []) {
    this.files = structuredClone(files);
  }

  async listPullRequestFiles(ref: PullRequestRef): Promise<PullRequestFile[]> {
    this.calls.push({ ...ref });
    return structuredClone(this.files);
  }

  async createCheckRun(ref: PullRequestRef, input: { name: string; headSha: string }): Promise<number> {
    const id = this.checkRuns.length + 1;
    this.checkRuns.push({ id, ref: { ...ref }, ...input, status: "in_progress" });
    return id;
  }

  async completeCheckRun(
    _ref: PullRequestRef,
    checkRunId: number,
    input: { conclusion: CheckConclusion; output: CheckRunOutput },
  ): Promise<void> {
    const run = this.checkRuns.find((candidate) => candidate.id === checkRunId);
    if (!run) throw Object.assign(new Error(`Check Run ${checkRunId} not found`), { status: 404 });
    Object.assign(run, { status: "completed", ...structuredClone(input) });
  }

  async createReview(ref: PullRequestRef, input: { commitId: string; body: string; comments: ReviewComment[] }): Promise<void> {
    this.reviews.push({ ref: { ...ref }, ...structuredClone(input) });
  }
}
