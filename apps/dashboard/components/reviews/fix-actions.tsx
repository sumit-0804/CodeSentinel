"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, GitCommitHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import type { Finding, RejectionReason } from "@code-sentinel/contracts";
import { commitFix, dismissFix } from "@/app/(app)/pull-requests/actions";
import { useStepUp } from "@/components/auth/step-up";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";

const REASONS: { value: RejectionReason; label: string }[] = [
  { value: "false_positive", label: "Not a real problem" },
  { value: "not_applicable", label: "Doesn't apply here" },
  { value: "will_fix_manually", label: "I'll fix it myself" },
  { value: "other", label: "Something else" },
];

const reasonLabel = (reason?: RejectionReason) => REASONS.find((r) => r.value === reason)?.label.toLowerCase();

/**
 * Commit fix / Dismiss for one posted fix (UC-3), or what was decided. Committing writes to the pull
 * request branch, so the gateway asks for an authenticator code first.
 */
export function FixActions({ finding, posted }: { finding: Finding; posted: boolean }) {
  const router = useRouter();
  const withStepUp = useStepUp();
  const [pending, startTransition] = useTransition();
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState<RejectionReason>("false_positive");
  const [comment, setComment] = useState("");
  const suggestion = finding.suggestion;
  if (!suggestion) return null;

  if (suggestion.state === "accepted") {
    return (
      <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-pass">
        <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
        {suggestion.commitSha ? (
          <>
            Committed in <code className="font-mono">{suggestion.commitSha.slice(0, 7)}</code>
          </>
        ) : (
          "Committed"
        )}
      </p>
    );
  }
  if (suggestion.state === "rejected") {
    return <p className="text-[13px] font-semibold text-ink-3">Dismissed{suggestion.rejectionReason ? `: ${reasonLabel(suggestion.rejectionReason)}` : ""}</p>;
  }
  if (suggestion.state === "superseded") return <p className="text-[13px] font-semibold text-ink-3">Replaced by a newer review</p>;
  // Not recorded yet (an older review), or never posted because it's below the threshold.
  if (!finding.id || !posted) return null;
  const findingId = finding.id;

  const commit = () =>
    startTransition(async () => {
      const result = await withStepUp(() => commitFix(findingId));
      if (!result) return;
      if (!result.ok) return void toast.error(result.message);
      toast.success(`Fix committed${result.commitSha ? ` in ${result.commitSha.slice(0, 7)}` : ""}. The pull request is reviewed again.`);
      router.refresh();
    });

  const dismiss = () =>
    startTransition(async () => {
      const result = await dismissFix(findingId, reason, comment);
      if (!result.ok) return void toast.error(result.message);
      setDismissing(false);
      toast.success("Fix dismissed. The finding stays in the report.");
      router.refresh();
    });

  if (dismissing) {
    return (
      <form
        className="grid max-w-[520px] gap-3 rounded-xl border border-line bg-panel-2 p-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          dismiss();
        }}
      >
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-[13px] font-semibold">Why dismiss this fix?</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {REASONS.map((r) => (
              <label key={r.value} className="inline-flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name={`reason-${findingId}`} value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="accent-cyan" />
                {r.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="grid gap-1.5 text-[13px] font-semibold">
          Comment (optional)
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={1000}
            rows={2}
            className="rounded-lg border border-line-2 bg-panel px-3 py-2 text-sm font-normal text-ink outline-none focus-visible:border-cyan"
          />
        </label>
        <div className="flex flex-wrap gap-2.5">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? <Loader label="Dismissing" /> : "Dismiss fix"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setDismissing(false)} disabled={pending}>
            Keep it
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Button size="sm" variant="default" onClick={commit} disabled={pending}>
        {pending ? (
          <Loader label="Committing the fix" />
        ) : (
          <>
            <GitCommitHorizontal className="size-[15px]" aria-hidden="true" />
            Commit fix
          </>
        )}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setDismissing(true)} disabled={pending}>
        <X className="size-[15px]" aria-hidden="true" />
        Dismiss
      </Button>
    </div>
  );
}
