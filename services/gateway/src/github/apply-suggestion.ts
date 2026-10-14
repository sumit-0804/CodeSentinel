import type { SuggestionRecord } from "../persistence/stores.js";
import { githubStatus, type GitHubClient, type PostedReviewComment, type PullRequestInfo, type RepositoryRef } from "./github-client.js";

const lines = (snippet: string) => snippet.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

/**
 * The file with lines `lineStart..lineEnd` replaced by the suggested snippet, keeping the file's line
 * endings; `undefined` when those lines no longer equal the original snippet (the file moved on).
 */
export function applySuggestionToText(
  text: string,
  fix: Pick<SuggestionRecord, "lineStart" | "lineEnd" | "originalSnippet" | "suggestedSnippet">,
): string | undefined {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const fileLines = text.split(/\r?\n/);
  const start = fix.lineStart - 1;
  const current = fileLines.slice(start, fix.lineEnd);
  const original = lines(fix.originalSnippet);
  if (start < 0 || fix.lineEnd > fileLines.length || current.length !== original.length || current.some((line, i) => line !== original[i])) {
    return undefined;
  }
  fileLines.splice(start, current.length, ...lines(fix.suggestedSnippet));
  return fileLines.join(eol);
}

/**
 * Pairs each posted inline comment with the fix it carries, by file and line range; a comment is
 * used once, so two fixes on the same lines each get their own comment, in order.
 */
export function matchPostedComments(
  suggestions: Pick<SuggestionRecord, "suggestionId" | "filePath" | "lineStart" | "lineEnd">[],
  comments: PostedReviewComment[],
): { suggestionId: string; commentId: number }[] {
  const unused = [...comments];
  const matched: { suggestionId: string; commentId: number }[] = [];
  for (const suggestion of suggestions) {
    const index = unused.findIndex(
      (c) => c.path === suggestion.filePath && c.line === suggestion.lineEnd && (c.startLine ?? c.line) === suggestion.lineStart,
    );
    if (index === -1) continue;
    matched.push({ suggestionId: suggestion.suggestionId, commentId: unused[index]!.id });
    unused.splice(index, 1);
  }
  return matched;
}

export type CommitSuggestionResult =
  | { ok: true; commitSha: string }
  | { ok: false; code: "pull_request_closed" | "head_moved" | "fork_not_supported" | "file_changed" | "github_permission_missing"; message: string };

/**
 * Commits one accepted fix onto the pull request's branch (UC-3, FR-GH-04): only onto the reviewed
 * head, never to a fork, and only if the reviewed lines are unchanged. GitHub outages are thrown.
 */
export async function commitSuggestion(
  github: Pick<GitHubClient, "getFileContent" | "updateFile">,
  input: { ref: RepositoryRef; repositoryFullName: string; pull: PullRequestInfo; suggestion: SuggestionRecord },
): Promise<CommitSuggestionResult> {
  const { ref, pull, suggestion } = input;
  if (pull.state !== "open") return { ok: false, code: "pull_request_closed", message: "The pull request is closed" };
  if (pull.headRepoFullName && pull.headRepoFullName.toLowerCase() !== input.repositoryFullName.toLowerCase()) {
    return { ok: false, code: "fork_not_supported", message: "The pull request comes from a fork, which the App can't push to; commit the fix on GitHub" };
  }
  if (pull.headSha !== suggestion.headSha) {
    return { ok: false, code: "head_moved", message: "The pull request has newer commits than the reviewed one; re-run the review" };
  }

  const file = await github.getFileContent(ref, { path: suggestion.filePath, gitRef: pull.headSha });
  const updated = file && applySuggestionToText(file.text, suggestion);
  if (!file || updated === undefined) return { ok: false, code: "file_changed", message: "Those lines changed since the review" };

  try {
    const commitSha = await github.updateFile(ref, {
      path: suggestion.filePath,
      text: updated,
      blobSha: file.sha,
      branch: pull.headRef,
      message: `Apply Code Sentinel fix: ${suggestion.title}`,
    });
    return { ok: true, commitSha };
  } catch (error) {
    const status = githubStatus(error);
    if (status === 403 || status === 404) {
      return { ok: false, code: "github_permission_missing", message: "The GitHub App needs Contents: Read and write to commit fixes" };
    }
    // 409 / 422: the branch moved between reading and writing.
    if (status === 409 || status === 422) return { ok: false, code: "head_moved", message: "The branch changed while committing; re-run the review" };
    throw error;
  }
}
