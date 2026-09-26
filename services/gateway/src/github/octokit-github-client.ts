import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";

import type {
  CheckConclusion,
  CheckRunOutput,
  GitHubClient,
  PullRequestFile,
  PullRequestRef,
  ReviewComment,
} from "./github-client.js";

const GitHubOctokit = Octokit.plugin(paginateRest);
const ANNOTATIONS_PER_REQUEST = 50;
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
 * `GitHubClient` for a real GitHub App (FR-GH-01..03): one Octokit per installation, authenticated with
 * a short-lived installation token (minted and cached by `@octokit/auth-app`), with pagination.
 */
export class OctokitGitHubClient implements GitHubClient {
  private readonly options: OctokitGitHubClientOptions;
  private readonly clients = new Map<number, GitHubOctokitInstance>();

  constructor(options: OctokitGitHubClientOptions) {
    this.options = options;
  }

  async listPullRequestFiles(ref: PullRequestRef): Promise<PullRequestFile[]> {
    // GitHub pages this list at 100 and stops at 3,000 files.
    const files: GitHubPullFile[] = await this.forRef(ref).paginate(
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

  async createCheckRun(ref: PullRequestRef, input: { name: string; headSha: string }): Promise<number> {
    const { data } = await this.forRef(ref).request("POST /repos/{owner}/{repo}/check-runs", {
      owner: ref.owner,
      repo: ref.repo,
      name: input.name,
      head_sha: input.headSha,
      status: "in_progress",
      started_at: new Date().toISOString(),
    });
    return Number(data.id);
  }

  async completeCheckRun(
    ref: PullRequestRef,
    checkRunId: number,
    input: { conclusion: CheckConclusion; output: CheckRunOutput },
  ): Promise<void> {
    const octokit = this.forRef(ref);
    const { annotations, ...text } = input.output;
    // GitHub takes 50 annotations per request and appends each batch to the run.
    const batches = chunk(annotations, ANNOTATIONS_PER_REQUEST);
    for (const [index, batch] of (batches.length ? batches : [[]]).entries()) {
      await octokit.request("PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}", {
        owner: ref.owner,
        repo: ref.repo,
        check_run_id: checkRunId,
        ...(index === 0 ? { status: "completed", conclusion: input.conclusion, completed_at: new Date().toISOString() } : {}),
        output: {
          ...text,
          annotations: batch.map((annotation) => ({
            path: annotation.path,
            start_line: annotation.startLine,
            end_line: annotation.endLine,
            annotation_level: annotation.level,
            title: annotation.title,
            message: annotation.message,
          })),
        },
      });
    }
  }

  async createReview(ref: PullRequestRef, input: { commitId: string; body: string; comments: ReviewComment[] }): Promise<void> {
    await this.forRef(ref).request("POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.pullNumber,
      commit_id: input.commitId,
      event: "COMMENT",
      body: input.body,
      comments: input.comments.map((comment) => ({
        path: comment.path,
        line: comment.line,
        side: "RIGHT" as const,
        ...(comment.startLine !== undefined && comment.startLine < comment.line ? { start_line: comment.startLine, start_side: "RIGHT" as const } : {}),
        body: comment.body,
      })),
    });
  }

  private forRef(ref: PullRequestRef): GitHubOctokitInstance {
    if (ref.installationId === undefined) {
      throw new Error(`No GitHub App installation for ${ref.owner}/${ref.repo}; the webhook carried none`);
    }
    return this.forInstallation(ref.installationId);
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

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
