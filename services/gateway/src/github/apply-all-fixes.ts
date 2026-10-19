import type { AgentKind, CombinedReport, Finding } from "@code-sentinel/contracts";

import type { RepositoryRecord, ReviewRecord, SuggestionRecord, SuggestionStore } from "../persistence/stores.js";
import { applySuggestionToText } from "./apply-suggestion.js";
import { githubStatus, type GitHubClient, type PullRequestInfo, type PullRequestRef } from "./github-client.js";
import { FIX_PRIORITY, postable } from "./review-output.js";

/** A fix identified by who found it and where, the same for a report finding and a stored suggestion. */
const fixKey = (agent: AgentKind, ruleId: string, filePath: string, lineStart: number, lineEnd: number) => `${agent}|${ruleId}|${filePath}|${lineStart}|${lineEnd}`;
export const findingFixKey = (f: Finding) => fixKey(f.agent, f.ruleId, f.location.filePath, f.location.lineStart, f.location.lineEnd);
export const suggestionFixKey = (s: SuggestionRecord) => fixKey(s.agent, s.ruleId, s.filePath, s.lineStart, s.lineEnd);

/** The review's fixes nobody has decided yet whose finding was posted (at or above the threshold), for the reviewed commit. */
export function openFixes(report: CombinedReport | undefined, threshold: number, headSha: string, suggestions: SuggestionRecord[]): SuggestionRecord[] {
  if (!report) return [];
  const posted = new Set(postable(report, threshold).filter((finding) => finding.suggestion).map(findingFixKey));
  return suggestions.filter((s) => s.state === "proposed" && s.headSha === headSha && posted.has(suggestionFixKey(s)));
}

export type SkippedFix = { suggestion: SuggestionRecord; reason: "overlaps_another_fix" | "file_changed" };

export type CommitAllResult =
  | { ok: true; commitSha: string; applied: SuggestionRecord[]; skipped: SkippedFix[] }
  | { ok: false; code: "pull_request_closed" | "head_moved" | "fork_not_supported" | "nothing_to_apply" | "github_permission_missing"; message: string };

const overlaps = (a: SuggestionRecord, b: SuggestionRecord) => a.filePath === b.filePath && a.lineStart <= b.lineEnd && b.lineStart <= a.lineEnd;

/** Where fixes overlap, the one higher in `FIX_PRIORITY` is kept: the fixes one commit can carry, and the rest. */
export function pickFixes(fixes: SuggestionRecord[]): { chosen: SuggestionRecord[]; overlapping: SuggestionRecord[] } {
  const chosen: SuggestionRecord[] = [];
  const overlapping: SuggestionRecord[] = [];
  for (const fix of [...fixes].sort((a, b) => FIX_PRIORITY.indexOf(a.agent) - FIX_PRIORITY.indexOf(b.agent))) {
    if (chosen.some((other) => overlaps(other, fix))) overlapping.push(fix);
    else chosen.push(fix);
  }
  return { chosen, overlapping };
}

/**
 * Commits every given fix in **one** commit onto the pull request's branch, with the same checks as one
 * fix (`commitSuggestion`): open, not a fork, still the reviewed head. Where fixes overlap, the one
 * higher in `FIX_PRIORITY` wins. Each file is edited bottom-up so earlier edits don't shift later ones;
 * a fix whose lines changed is skipped. GitHub outages are thrown.
 */
export async function commitAllFixes(
  github: Pick<GitHubClient, "getFileContent" | "commitFiles">,
  input: { ref: PullRequestRef; repositoryFullName: string; pull: PullRequestInfo; fixes: SuggestionRecord[] },
): Promise<CommitAllResult> {
  const { ref, pull } = input;
  if (pull.state !== "open") return { ok: false, code: "pull_request_closed", message: "The pull request is closed" };
  if (pull.headRepoFullName && pull.headRepoFullName.toLowerCase() !== input.repositoryFullName.toLowerCase()) {
    return { ok: false, code: "fork_not_supported", message: "The pull request comes from a fork, which the App can't push to" };
  }
  if (input.fixes.some((fix) => fix.headSha !== pull.headSha)) {
    return { ok: false, code: "head_moved", message: "The pull request has newer commits than the reviewed one; re-run the review" };
  }

  const { chosen, overlapping } = pickFixes(input.fixes);
  const skipped: SkippedFix[] = overlapping.map((suggestion) => ({ suggestion, reason: "overlaps_another_fix" }));

  const files: { path: string; text: string }[] = [];
  const applied: SuggestionRecord[] = [];
  for (const path of [...new Set(chosen.map((fix) => fix.filePath))]) {
    const file = await github.getFileContent(ref, { path, gitRef: pull.headSha });
    let text = file?.text;
    let changed = false;
    for (const fix of chosen.filter((f) => f.filePath === path).sort((a, b) => b.lineStart - a.lineStart)) {
      const next = text === undefined ? undefined : applySuggestionToText(text, fix);
      if (next === undefined) {
        skipped.push({ suggestion: fix, reason: "file_changed" });
        continue;
      }
      text = next;
      changed = true;
      applied.push(fix);
    }
    if (changed && text !== undefined) files.push({ path, text });
  }
  if (files.length === 0) return { ok: false, code: "nothing_to_apply", message: "None of the fixes could still be applied; re-run the review" };

  try {
    const commitSha = await github.commitFiles(ref, {
      branch: pull.headRef,
      parentSha: pull.headSha,
      files,
      message: `Apply ${applied.length} Code Sentinel fix${applied.length === 1 ? "" : "es"}`,
    });
    return { ok: true, commitSha, applied, skipped };
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

export interface ApplyAllDeps {
  suggestions: Pick<SuggestionStore, "forReview" | "accept">;
  github: Pick<GitHubClient, "getPullRequest" | "getFileContent" | "commitFiles" | "commentOnPullRequest">;
  now: () => Date;
  /** The dashboard's base URL; when set, the comment links to the review's page and to sign-in. */
  dashboardUrl?: string;
}

export type ApplyAllOutcome =
  | { ok: true; commitSha: string; applied: number; aiApplied: number; skipped: number }
  | Extract<CommitAllResult, { ok: false }>;

/**
 * "Apply all fixes" (UC-3, one commit): every open fix of the review, Style's exact ones and the AI
 * ones, committed together. Each applied fix is recorded as accepted with the commit, and one comment
 * on the pull request says what was applied and what was skipped. Shared by the Check Run button and
 * the dashboard; `requestedBy` names who asked.
 */
export async function applyAllFixes(
  deps: ApplyAllDeps,
  input: { review: ReviewRecord; repository: RepositoryRecord; userId?: string; requestedBy: string },
): Promise<ApplyAllOutcome> {
  const { review, repository } = input;
  if (review.prNumber === undefined) return { ok: false, code: "pull_request_closed", message: "This review has no pull request" };
  const open = openFixes(review.report, review.confidenceThreshold, review.headSha, await deps.suggestions.forReview(review.reviewId));
  // Without a Code Sentinel user (a GitHub collaborator with no account here) only exact fixes are applied (FR-GH-04).
  const fixes = input.userId ? open : open.filter((fix) => fix.kind === "deterministic");
  const heldBack = open.length - fixes.length;

  const [owner = "", repo = ""] = repository.fullName.split("/");
  const ref: PullRequestRef = {
    ...(repository.githubInstallationNumber !== undefined ? { installationId: repository.githubInstallationNumber } : {}),
    owner,
    repo,
    pullNumber: review.prNumber,
  };
  const links = deps.dashboardUrl
    ? { review: `${deps.dashboardUrl}/pull-requests/${review.reviewId}`, signIn: `${deps.dashboardUrl}/sign-in` }
    : undefined;
  if (fixes.length === 0) {
    if (heldBack > 0) await deps.github.commentOnPullRequest(ref, heldBackNote(heldBack, links));
    return { ok: false, code: "nothing_to_apply", message: heldBack > 0 ? "Only AI fixes are open, and they need a Code Sentinel user" : "This review has no open fixes" };
  }
  const pull = await deps.github.getPullRequest(ref);
  if (!pull) return { ok: false, code: "pull_request_closed", message: "The pull request no longer exists" };

  const result = await commitAllFixes(deps.github, { ref, repositoryFullName: repository.fullName, pull, fixes });
  if (!result.ok) return result;

  const at = deps.now();
  for (const fix of result.applied) {
    await deps.suggestions.accept(fix.suggestionId, { ...(input.userId ? { userId: input.userId } : {}), commitSha: result.commitSha, at });
  }
  const aiApplied = result.applied.filter((fix) => fix.kind === "ai_suggested").length;
  const comment = appliedComment(result, aiApplied, input.requestedBy, heldBack > 0 ? undefined : links);
  await deps.github.commentOnPullRequest(ref, heldBack > 0 ? `${comment}\n\n${heldBackNote(heldBack, links)}` : comment);
  return { ok: true, commitSha: result.commitSha, applied: result.applied.length, aiApplied, skipped: result.skipped.length };
}

const SKIP_WORD: Record<SkippedFix["reason"], string> = {
  overlaps_another_fix: "overlaps a fix that was applied",
  file_changed: "its lines changed since the review",
};

type DashboardLinks = { review: string; signIn: string };

function heldBackNote(count: number, links: DashboardLinks | undefined): string {
  const signIn = links ? `[Sign in to Code Sentinel](${links.signIn})` : "Sign in to Code Sentinel";
  const dashboard = links ? `[this review on the dashboard](${links.review})` : "the dashboard";
  return (
    `**${count} AI-suggested fix${count === 1 ? " was" : "es were"} not applied.** Whoever clicked has no Code Sentinel account in this ` +
    `organization, and an AI fix needs a person who can answer for it. ${signIn} with GitHub, or apply them from ${dashboard}.`
  );
}

function appliedComment(
  result: Extract<CommitAllResult, { ok: true }>,
  aiApplied: number,
  requestedBy: string,
  links: DashboardLinks | undefined,
): string {
  const n = result.applied.length;
  const lines = [
    `**Code Sentinel applied ${n} fix${n === 1 ? "" : "es"}${aiApplied ? ` (${aiApplied} AI-suggested)` : ""} in ${result.commitSha}**, as ${requestedBy} asked.`,
    "",
    ...result.applied.map((fix) => `- \`${fix.filePath}:${fix.lineStart}\` ${fix.title}`),
  ];
  if (aiApplied) lines.push("", "_AI-suggested fixes are worth a read in the new commit before merging._");
  if (result.skipped.length) {
    lines.push("", `**Not applied (${result.skipped.length})**`, ...result.skipped.map(({ suggestion, reason }) => `- \`${suggestion.filePath}:${suggestion.lineStart}\` ${suggestion.title}: ${SKIP_WORD[reason]}`));
  }
  if (links) lines.push("", `[View this review on Code Sentinel](${links.review})`);
  return lines.join("\n");
}
