import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";

import type { GitHubClient, PullRequestFile, PullRequestRef } from "./github-client.js";

const GitHubOctokit = Octokit.plugin(paginateRest);
type GitHubOctokitInstance = InstanceType<typeof GitHubOctokit>;

export interface OctokitGitHubClientOptions {
  appId: number;
  /** PEM contents of the GitHub App private key. */
  privateKey: string;
  /** Defaults to the global `fetch`; injected in tests. */
  fetch?: typeof fetch;
  baseUrl?: string;
}

/** The fields of a "list pull request files" item that map to `PullRequestFile`. */
interface GitHubPullFile {
  filename: string;
  status: PullRequestFile["status"];
  patch?: string;
  previous_filename?: string;
}

/**
 * `GitHubClient` for a real GitHub App (FR-GH-01): one Octokit per installation, authenticated with
 * a short-lived installation token (minted and cached by `@octokit/auth-app`), with pagination.
 */
export class OctokitGitHubClient implements GitHubClient {
  private readonly options: OctokitGitHubClientOptions;
  private readonly clients = new Map<number, GitHubOctokitInstance>();

  constructor(options: OctokitGitHubClientOptions) {
    this.options = options;
  }

  async listPullRequestFiles(ref: PullRequestRef): Promise<PullRequestFile[]> {
    if (ref.installationId === undefined) {
      throw new Error(`No GitHub App installation for ${ref.owner}/${ref.repo}; the webhook carried none`);
    }
    // GitHub pages this list at 100 and stops at 3,000 files.
    const files: GitHubPullFile[] = await this.forInstallation(ref.installationId).paginate(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
      { owner: ref.owner, repo: ref.repo, pull_number: ref.pullNumber, per_page: 100 },
    );
    return files.map((file) => ({
      filename: file.filename,
      status: file.status,
      ...(file.patch !== undefined ? { patch: file.patch } : {}),
      ...(file.previous_filename !== undefined ? { previousFilename: file.previous_filename } : {}),
    }));
  }

  private forInstallation(installationId: number): GitHubOctokitInstance {
    let client = this.clients.get(installationId);
    if (!client) {
      const { appId, privateKey, fetch: fetchImpl, baseUrl } = this.options;
      client = new GitHubOctokit({
        authStrategy: createAppAuth,
        auth: { appId, privateKey, installationId },
        ...(baseUrl ? { baseUrl } : {}),
        ...(fetchImpl ? { request: { fetch: fetchImpl } } : {}),
      });
      this.clients.set(installationId, client);
    }
    return client;
  }
}
