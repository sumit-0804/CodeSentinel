import type { GatewayFailure } from "@/lib/gateway";

const MESSAGES: Record<string, string> = {
  review_in_progress: "A review of this pull request just started. Give it a moment.",
  no_reviewable_files: "Every changed file is skipped (lockfiles, generated or binary), so there's nothing to review.",
  branch_ignored: "This pull request's base branch isn't reviewed. Add it under Advanced → Branches to review.",
  repository_disabled: "Reviews are off for this repository. Turn them on first.",
  pull_request_not_found: "That pull request is no longer open on GitHub.",
  repository_not_found: "This repository isn't in your organization any more.",
  github_unavailable: "GitHub didn't answer. Try again in a moment.",
  orchestrator_unavailable: "The review service didn't answer. Try again in a moment.",
};

/** What the person sees when the gateway won't start a re-run: its error code first, then how the call failed. */
export function rerunFailureMessage(failure: { reason: GatewayFailure; code?: string }): string {
  if (failure.code && MESSAGES[failure.code]) return MESSAGES[failure.code]!;
  if (failure.reason === "unreachable" || failure.reason === "unconfigured") return "Couldn't reach the API. Try again in a moment.";
  return "The review couldn't be started. Try again in a moment.";
}
