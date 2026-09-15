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

/** Outbound GitHub calls. The Octokit implementation (installation tokens, pagination) is a later step. */
export interface GitHubClient {
  listPullRequestFiles(ref: PullRequestRef): Promise<PullRequestFile[]>;
}
