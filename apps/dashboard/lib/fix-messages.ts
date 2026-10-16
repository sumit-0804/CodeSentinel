import type { GatewayFailure } from "@/lib/gateway";

const MESSAGES: Record<string, string> = {
  suggestion_decided: "This fix was already committed, dismissed, or replaced by a newer review. Reload to see it.",
  pull_request_closed: "The pull request is closed, so there's nowhere to commit the fix.",
  head_moved: "The pull request has newer commits than the reviewed one. Re-run the review, then commit from the new one.",
  fork_not_supported: "This pull request comes from a fork, which Code Sentinel can't push to. Commit the suggestion on GitHub instead.",
  file_changed: "Those lines changed since the review, so the fix no longer applies. Re-run the review.",
  github_permission_missing: "The GitHub App can't write to this repository yet. An admin needs to grant Contents: Read and write on GitHub.",
  github_unavailable: "GitHub didn't answer. Try again in a moment.",
  finding_not_found: "This finding isn't in your organization any more.",
  review_not_found: "This review isn't in your organization any more.",
  nothing_to_apply: "There are no open fixes left to apply, or none still matches the code. Re-run the review.",
  mfa_required: "Enter a code from your authenticator app to commit this fix.",
};

/** What the person sees when the gateway won't commit or dismiss a fix. */
export function fixFailureMessage(failure: { reason: GatewayFailure; code?: string }): string {
  if (failure.code && MESSAGES[failure.code]) return MESSAGES[failure.code]!;
  if (failure.reason === "unreachable" || failure.reason === "unconfigured") return "Couldn't reach the API. Try again in a moment.";
  return "That didn't work. Try again in a moment.";
}
