import type { AuditAction, AuditEvent } from "@code-sentinel/contracts";

const ACTION: Record<AuditAction, string> = {
  repository_config_updated: "Changed repository settings",
  review_defaults_updated: "Changed review defaults",
  repository_reviews_toggled: "Switched reviews",
  fix_accepted: "Committed a fix",
  fix_rejected: "Dismissed a fix",
  fixes_applied: "Applied all fixes",
  review_rerun: "Re-ran a review",
  github_linked: "Connected GitHub",
  installations_synced: "Synced repositories",
  session_revoked: "Signed out a device",
  step_up_refused: "Was asked for an authenticator code",
};

const FIELD: Record<string, string> = {
  reviewEnabled: "reviews",
  useOrgDefaults: "organization defaults",
  agents: "agents",
  reviewBranches: "branches",
  confidenceThresholdOverride: "threshold",
  confidenceThreshold: "threshold",
  agentTimeoutMs: "timeout",
  autoFixStyle: "auto-fix",
  postInlineComments: "inline comments",
};

const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const number = (value: unknown) => (typeof value === "number" ? value : undefined);

/** One line saying what happened, from the action and its metadata. */
export function describeAuditEvent(event: AuditEvent): string {
  const meta = event.metadata ?? {};
  const where = text(meta.repository);
  const pr = number(meta.pullRequestNumber);
  const onPr = where ? ` on ${where}${pr !== undefined ? `#${pr}` : ""}` : "";

  switch (event.action) {
    case "repository_reviews_toggled":
      return `${meta.reviewEnabled === false ? "Switched reviews off" : "Switched reviews on"}`;
    case "repository_config_updated":
    case "review_defaults_updated": {
      const changed = Array.isArray(meta.changed) ? meta.changed.filter((key): key is string => typeof key === "string") : [];
      const names = [...new Set(changed.map((key) => FIELD[key] ?? key))];
      return names.length ? `${ACTION[event.action]}: ${names.join(", ")}` : ACTION[event.action];
    }
    case "fixes_applied": {
      const applied = number(meta.applied);
      const count = applied !== undefined ? `Applied ${applied} fix${applied === 1 ? "" : "es"}` : ACTION.fixes_applied;
      return `${count}${onPr}${meta.via === "check_run" ? " from the Check Run" : ""}`;
    }
    case "fix_rejected":
      return `${ACTION.fix_rejected}${text(meta.reason) ? ` (${text(meta.reason)!.replaceAll("_", " ")})` : ""}`;
    case "step_up_refused":
      return `${ACTION.step_up_refused}${text(meta.path) ? ` (${text(meta.method) ?? ""} ${text(meta.path)})` : ""}`;
    default:
      return `${ACTION[event.action]}${onPr}`;
  }
}
