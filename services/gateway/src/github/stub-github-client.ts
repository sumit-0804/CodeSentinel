import type { GitHubClient, PullRequestFile, PullRequestRef } from "./github-client.js";

/** Returns the same files for every pull request and records each call. For tests and `GATEWAY_SEED=dev`. */
export class StubGitHubClient implements GitHubClient {
  readonly calls: PullRequestRef[] = [];
  private readonly files: PullRequestFile[];

  constructor(files: PullRequestFile[] = []) {
    this.files = structuredClone(files);
  }

  async listPullRequestFiles(ref: PullRequestRef): Promise<PullRequestFile[]> {
    this.calls.push({ ...ref });
    return structuredClone(this.files);
  }
}
