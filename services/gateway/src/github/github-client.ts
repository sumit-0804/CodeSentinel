/** The fields of GitHub's "list pull request files" item that the gateway uses. */
export interface PullRequestFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed" | "copied" | "changed" | "unchanged";
  /** Omitted by GitHub for binary files and diffs too large to render. */
  patch?: string;
  previousFilename?: string;
}

export interface PullRequestRef {
  /** GitHub's numeric installation id, used to mint an installation token. */
  installationId?: number;
  owner: string;
  repo: string;
  pullNumber: number;
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

/** Outbound GitHub calls: PR files in, Check Runs and reviews out (FR-GH-01..03). */
export interface GitHubClient {
  listPullRequestFiles(ref: PullRequestRef): Promise<PullRequestFile[]>;
  /** Creates an `in_progress` Check Run on `headSha` and returns its id. */
  createCheckRun(ref: PullRequestRef, input: { name: string; headSha: string }): Promise<number>;
  /** Completes a Check Run; annotations beyond GitHub's 50-per-request limit are sent in batches. */
  completeCheckRun(ref: PullRequestRef, checkRunId: number, input: { conclusion: CheckConclusion; output: CheckRunOutput }): Promise<void>;
  /** Posts one review with `event: COMMENT`: it never approves or blocks the pull request. */
  createReview(ref: PullRequestRef, input: { commitId: string; body: string; comments: ReviewComment[] }): Promise<void>;
}

/** The HTTP status of a failed GitHub call (Octokit's `RequestError` carries it), if any. */
export function githubStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}
