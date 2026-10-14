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
