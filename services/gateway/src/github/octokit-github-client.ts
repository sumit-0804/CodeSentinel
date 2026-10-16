import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";

import {
  githubStatus,
  type CheckConclusion,
  type CheckRunAction,
  type CheckRunOutput,
  type GitHubClient,
  type InstallationRepository,
  type PostedReviewComment,
  type PullRequestFile,
  type PullRequestInfo,
  type PullRequestRef,
  type RepositoryRef,
  type ReviewComment,
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

interface GitHubRepositoryItem {
  id: number | bigint;
  full_name: string;
  default_branch?: string;
  private: boolean;
  language?: string | null;
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

  async listInstallationRepositories(installationId: number): Promise<InstallationRepository[]> {
    // The paginate plugin unwraps `{ total_count, repositories }` into one array.
    const repos: GitHubRepositoryItem[] = await this.forInstallation(installationId).paginate("GET /installation/repositories", {
      per_page: 100,
    });
    return repos.map((repo) => ({
      id: Number(repo.id),
      fullName: repo.full_name,
      defaultBranch: repo.default_branch ?? "main",
      isPrivate: repo.private,
      ...(repo.language ? { language: repo.language } : {}),
    }));
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

  async getPullRequest(ref: PullRequestRef): Promise<PullRequestInfo | undefined> {
    try {
      const { data } = await this.forRef(ref).request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.pullNumber,
      });
      return toPullRequestInfo(data);
    } catch (error) {
      if (githubStatus(error) === 404) return undefined;
      throw error;
    }
  }

  async listOpenPullRequests(ref: RepositoryRef, limit: number): Promise<PullRequestInfo[]> {
    const { data } = await this.forRef(ref).request("GET /repos/{owner}/{repo}/pulls", {
      owner: ref.owner,
      repo: ref.repo,
      state: "open",
      sort: "updated",
      direction: "desc",
      per_page: Math.min(limit, 100),
    });
    return data.map(toPullRequestInfo);
  }

  async listBranches(ref: RepositoryRef, limit: number): Promise<string[]> {
    const names: string[] = [];
    // `done()` stops paging once `limit` names are in, so a repository with thousands of branches stays cheap.
    await this.forRef(ref).paginate("GET /repos/{owner}/{repo}/branches", { owner: ref.owner, repo: ref.repo, per_page: 100 }, (response, done) => {
      names.push(...response.data.map((branch) => branch.name));
      if (names.length >= limit) done();
      return [];
    });
    return names.slice(0, limit);
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
    input: { conclusion: CheckConclusion; output: CheckRunOutput; actions?: CheckRunAction[] },
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
        ...(index === 0 && input.actions?.length ? { actions: input.actions } : {}),
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

  async listReviewComments(ref: PullRequestRef, reviewIds: number[]): Promise<PostedReviewComment[]> {
    // The per-review comments endpoint leaves `line` and `start_line` null; the pull request's list has them.
    const comments = await this.forRef(ref).paginate("GET /repos/{owner}/{repo}/pulls/{pull_number}/comments", {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.pullNumber,
      per_page: 100,
    });
    const wanted = new Set(reviewIds);
    return comments.filter((comment) => comment.pull_request_review_id != null && wanted.has(Number(comment.pull_request_review_id))).map((comment) => ({
      id: Number(comment.id),
      path: comment.path,
      ...(comment.line != null ? { line: comment.line } : {}),
      ...(comment.start_line != null ? { startLine: comment.start_line } : {}),
    }));
  }

  async replyToReviewComment(ref: PullRequestRef, commentId: number, body: string): Promise<void> {
    await this.forRef(ref).request("POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies", {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.pullNumber,
      comment_id: commentId,
      body,
    });
  }

  async getFileContent(ref: RepositoryRef, input: { path: string; gitRef: string }): Promise<{ sha: string; text: string } | undefined> {
    try {
      const { data } = await this.forRef(ref).request("GET /repos/{owner}/{repo}/contents/{path}", {
        owner: ref.owner,
        repo: ref.repo,
        path: input.path,
        ref: input.gitRef,
      });
      if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return undefined;
      return { sha: data.sha, text: Buffer.from(data.content, "base64").toString("utf8") };
    } catch (error) {
      if (githubStatus(error) === 404) return undefined;
      throw error;
    }
  }

  async updateFile(ref: RepositoryRef, input: { path: string; text: string; blobSha: string; branch: string; message: string }): Promise<string> {
    const { data } = await this.forRef(ref).request("PUT /repos/{owner}/{repo}/contents/{path}", {
      owner: ref.owner,
      repo: ref.repo,
      path: input.path,
      message: input.message,
      content: Buffer.from(input.text, "utf8").toString("base64"),
      sha: input.blobSha,
      branch: input.branch,
    });
    return data.commit.sha ?? "";
  }

  async commitFiles(ref: RepositoryRef, input: { branch: string; parentSha: string; files: { path: string; text: string }[]; message: string }): Promise<string> {
    const octokit = this.forRef(ref);
    const repo = { owner: ref.owner, repo: ref.repo };
    // Keep each file's mode (an executable script stays executable); a truncated tree falls back to a plain file.
    const { data: parent } = await octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", { ...repo, tree_sha: input.parentSha, recursive: "1" });
    const modes = new Map(parent.tree.map((entry) => [entry.path, entry.mode]));
    const { data: tree } = await octokit.request("POST /repos/{owner}/{repo}/git/trees", {
      ...repo,
      base_tree: parent.sha,
      tree: input.files.map((file) => ({ path: file.path, mode: modes.get(file.path) === "100755" ? ("100755" as const) : ("100644" as const), type: "blob" as const, content: file.text })),
    });
    const { data: commit } = await octokit.request("POST /repos/{owner}/{repo}/git/commits", {
      ...repo,
      message: input.message,
      tree: tree.sha,
      parents: [input.parentSha],
    });
    // Not forced: if someone pushed meanwhile, GitHub answers 422 and nothing changes.
    await octokit.request("PATCH /repos/{owner}/{repo}/git/refs/{ref}", { ...repo, ref: `heads/${input.branch}`, sha: commit.sha, force: false });
    return commit.sha;
  }

  async commentOnPullRequest(ref: PullRequestRef, body: string): Promise<void> {
    await this.forRef(ref).request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.pullNumber,
      body,
    });
  }

  async createReview(ref: PullRequestRef, input: { commitId: string; body: string; comments: ReviewComment[] }): Promise<number> {
    const { data } = await this.forRef(ref).request("POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
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
    return Number(data.id);
  }

  private forRef(ref: RepositoryRef): GitHubOctokitInstance {
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

/** The fields of GitHub's pull request object that map to `PullRequestInfo`. */
interface GitHubPull {
  number: number;
  title: string;
  user: { login: string } | null;
  state: string;
  draft?: boolean;
  head: { sha: string; ref: string; repo: { full_name: string } | null };
  base: { sha: string; ref: string };
  updated_at: string;
  html_url: string;
}

function toPullRequestInfo(pull: GitHubPull): PullRequestInfo {
  return {
    number: pull.number,
    title: pull.title,
    ...(pull.user ? { author: pull.user.login } : {}),
    state: pull.state === "open" ? "open" : "closed",
    draft: pull.draft ?? false,
    headSha: pull.head.sha,
    headRef: pull.head.ref,
    ...(pull.head.repo ? { headRepoFullName: pull.head.repo.full_name } : {}),
    baseSha: pull.base.sha,
    baseRef: pull.base.ref,
    updatedAt: pull.updated_at,
    htmlUrl: pull.html_url,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
