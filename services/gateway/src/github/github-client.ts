/** The fields of GitHub's "list pull request files" item that the gateway uses. */
export interface PullRequestFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed" | "copied" | "changed" | "unchanged";
  /** Omitted by GitHub for binary files and diffs too large to render. */
  patch?: string;
  previousFilename?: string;
}

export interface RepositoryRef {
  /** GitHub's numeric installation id, used to mint an installation token. */
  installationId?: number;
  owner: string;
  repo: string;
}

export interface PullRequestRef extends RepositoryRef {
  pullNumber: number;
}

/** The fields of a GitHub pull request the gateway uses. */
export interface PullRequestInfo {
  number: number;
  title: string;
  /** The author's login; absent for a deleted ("ghost") account. */
  author?: string;
  state: "open" | "closed";
  draft: boolean;
  headSha: string;
  headRef: string;
  /** `owner/name` of the head branch's repository; differs from the base repository for a fork. */
  headRepoFullName?: string;
  baseSha: string;
  baseRef: string;
  updatedAt: string;
  htmlUrl: string;
}

export type CheckConclusion = "success" | "failure" | "neutral";

/** One line-level note on a Check Run; GitHub accepts at most 50 per request. */
export interface CheckAnnotation {
  path: string;
  startLine: number;
  endLine: number;
  level: "notice" | "warning" | "failure";
  title: string;
  message: string;
}

export interface CheckRunOutput {
  title: string;
  /** Markdown shown on the Check Run page. */
  summary: string;
  annotations: CheckAnnotation[];
}

/** An inline pull request review comment on the new side of the diff. */
export interface ReviewComment {
  path: string;
  /** Last line of the range. */
  line: number;
  /** First line, when the comment spans several lines. */
  startLine?: number;
  /** Markdown, possibly with a ```suggestion block. */
  body: string;
}

/** An inline comment as GitHub stored it. */
export interface PostedReviewComment {
  id: number;
  path: string;
  /** Last line of the range, on the new side. */
  line?: number;
  startLine?: number;
}

/** A repository an installation of the App can access. */
export interface InstallationRepository {
  id: number;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  language?: string;
}

/** Outbound GitHub calls as the App: PR files in, Check Runs and reviews out (FR-GH-01..03). */
export interface GitHubClient {
  /** Every repository the installation covers, for the installation sync (A6). */
  listInstallationRepositories(installationId: number): Promise<InstallationRepository[]>;
  listPullRequestFiles(ref: PullRequestRef): Promise<PullRequestFile[]>;
  /** One pull request; `undefined` when GitHub answers 404. */
  getPullRequest(ref: PullRequestRef): Promise<PullRequestInfo | undefined>;
  /** Open pull requests, most recently updated first, at most `limit`. */
  listOpenPullRequests(ref: RepositoryRef, limit: number): Promise<PullRequestInfo[]>;
  /** Branch names in GitHub's order, at most `limit`. */
  listBranches(ref: RepositoryRef, limit: number): Promise<string[]>;
  /** Creates an `in_progress` Check Run on `headSha` and returns its id. */
  createCheckRun(ref: PullRequestRef, input: { name: string; headSha: string }): Promise<number>;
  /** Completes a Check Run; annotations beyond GitHub's 50-per-request limit are sent in batches. */
  completeCheckRun(ref: PullRequestRef, checkRunId: number, input: { conclusion: CheckConclusion; output: CheckRunOutput }): Promise<void>;
  /** Posts one review with `event: COMMENT`: it never approves or blocks the pull request. Returns GitHub's review id. */
  createReview(ref: PullRequestRef, input: { commitId: string; body: string; comments: ReviewComment[] }): Promise<number>;
  /** The inline comments these reviews posted, with GitHub's ids, so fixes can be matched to their comment. */
  listReviewComments(ref: PullRequestRef, reviewIds: number[]): Promise<PostedReviewComment[]>;
  /** Answers an inline comment in its thread. */
  replyToReviewComment(ref: PullRequestRef, commentId: number, body: string): Promise<void>;
  /** A file's text and blob sha at a branch or commit; `undefined` when GitHub answers 404. */
  getFileContent(ref: RepositoryRef, input: { path: string; gitRef: string }): Promise<{ sha: string; text: string } | undefined>;
  /** Commits a new version of one file onto a branch (Contents: write); returns the commit's sha. */
  updateFile(ref: RepositoryRef, input: { path: string; text: string; blobSha: string; branch: string; message: string }): Promise<string>;
}

/** The HTTP status of a failed GitHub call (Octokit's `RequestError` carries it), if any. */
export function githubStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}
