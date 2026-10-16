import type {
  CheckConclusion,
  CheckRunOutput,
  GitHubClient,
  InstallationRepository,
  PostedReviewComment,
  PullRequestFile,
  PullRequestInfo,
  PullRequestRef,
  RepositoryRef,
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
  /** Repositories each installation covers, keyed by GitHub's installation id; tests edit it. */
  readonly installationRepositories = new Map<number, InstallationRepository[]>();
  /** Pull requests `getPullRequest` and `listOpenPullRequests` answer from; tests edit it. */
  readonly pullRequests: PullRequestInfo[] = [];
  pullRequestListCalls = 0;
  /** Branch names `listBranches` answers with; tests edit it. */
  readonly branches: string[] = [];
  branchListCalls = 0;
  /** Repository files by path for `getFileContent` / `updateFile`; tests edit it. */
  readonly repoFiles = new Map<string, { sha: string; text: string }>();
  readonly commits: { path: string; text: string; blobSha: string; branch: string; message: string; commitSha: string }[] = [];
  readonly replies: { ref: PullRequestRef; commentId: number; body: string }[] = [];
  private readonly files: PullRequestFile[];

  constructor(files: PullRequestFile[] = []) {
    this.files = structuredClone(files);
  }

  async listInstallationRepositories(installationId: number): Promise<InstallationRepository[]> {
    return structuredClone(this.installationRepositories.get(installationId) ?? []);
  }

  async listPullRequestFiles(ref: PullRequestRef): Promise<PullRequestFile[]> {
    this.calls.push({ ...ref });
    return structuredClone(this.files);
  }

  async getPullRequest(ref: PullRequestRef): Promise<PullRequestInfo | undefined> {
    return structuredClone(this.pullRequests.find((pull) => pull.number === ref.pullNumber));
  }

  async listOpenPullRequests(_ref: RepositoryRef, limit: number): Promise<PullRequestInfo[]> {
    this.pullRequestListCalls++;
    return structuredClone(
      this.pullRequests
        .filter((pull) => pull.state === "open")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit),
    );
  }

  async listBranches(_ref: RepositoryRef, limit: number): Promise<string[]> {
    this.branchListCalls++;
    return this.branches.slice(0, limit);
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

  /** Review ids are 1, 2, …; comment ids are `reviewId * 1000 + index`. */
  async createReview(ref: PullRequestRef, input: { commitId: string; body: string; comments: ReviewComment[] }): Promise<number> {
    this.reviews.push({ ref: { ...ref }, ...structuredClone(input) });
    return this.reviews.length;
  }

  async listReviewComments(_ref: PullRequestRef, reviewIds: number[]): Promise<PostedReviewComment[]> {
    return reviewIds.flatMap((reviewId) =>
      (this.reviews[reviewId - 1]?.comments ?? []).map((comment, index) => ({
        id: reviewId * 1000 + index,
        path: comment.path,
        line: comment.line,
        ...(comment.startLine !== undefined ? { startLine: comment.startLine } : {}),
      })),
    );
  }

  async replyToReviewComment(ref: PullRequestRef, commentId: number, body: string): Promise<void> {
    this.replies.push({ ref: { ...ref }, commentId, body });
  }

  async getFileContent(_ref: RepositoryRef, input: { path: string; gitRef: string }): Promise<{ sha: string; text: string } | undefined> {
    return structuredClone(this.repoFiles.get(input.path));
  }

  async updateFile(_ref: RepositoryRef, input: { path: string; text: string; blobSha: string; branch: string; message: string }): Promise<string> {
    const current = this.repoFiles.get(input.path);
    if (current && current.sha !== input.blobSha) throw Object.assign(new Error("sha does not match"), { status: 409 });
    const commitSha = `${this.commits.length + 1}`.padStart(40, "c");
    this.commits.push({ ...structuredClone(input), commitSha });
    this.repoFiles.set(input.path, { sha: `blob-${commitSha}`, text: input.text });
    return commitSha;
  }
}
