"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitCommitHorizontal } from "lucide-react";
import { toast } from "sonner";
import { applyAllFixes } from "@/app/(app)/pull-requests/actions";
import { useStepUp } from "@/components/auth/step-up";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Loader } from "@/components/ui/loader";

/**
 * "Apply all fixes (N)": every open fix of the review, Style's exact ones and the AI ones, in one
 * commit. A dialog says how many are AI-suggested first; the gateway then asks for an authenticator code.
 */
export function ApplyAllFixes({ reviewId, total, ai, overlapping }: { reviewId: string; total: number; ai: number; overlapping: number }) {
  const router = useRouter();
  const withStepUp = useStepUp();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  if (total === 0) return null;

  const apply = () =>
    startTransition(async () => {
      setOpen(false);
      const result = await withStepUp(() => applyAllFixes(reviewId));
      if (!result) return;
      if (!result.ok) return void toast.error(result.message);
      const skipped = result.skipped ? ` ${result.skipped} couldn't be applied; see the comment on GitHub.` : "";
      toast.success(`${result.applied} fix${result.applied === 1 ? "" : "es"} committed in ${result.commitSha.slice(0, 7)}.${skipped} The pull request is reviewed again.`);
      router.refresh();
    });

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={pending}>
        {pending ? (
          <Loader label="Committing the fixes" />
        ) : (
          <>
            <GitCommitHorizontal className="size-[15px]" aria-hidden="true" />
            Apply all fixes ({total})
          </>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] gap-5 rounded-2xl border border-line-2 bg-panel p-6 sm:max-w-[440px]">
          <div className="grid gap-1.5">
            <DialogTitle className="font-display text-lg leading-tight font-semibold">
              Commit {total} fix{total === 1 ? "" : "es"} in one commit?
            </DialogTitle>
            <DialogDescription className="text-sm text-ink-2">
              {ai > 0
                ? `${ai} of them ${ai === 1 ? "is" : "are"} AI-suggested: read ${ai === 1 ? "it" : "them"} in the findings below before committing. `
                : "All of them are exact formatter fixes. "}
              {overlapping > 0
                ? `${overlapping} other fix${overlapping === 1 ? "" : "es"} on the same lines ${overlapping === 1 ? "is" : "are"} left out; commit ${overlapping === 1 ? "it" : "them"} one by one if you prefer. `
                : ""}
              The commit goes onto the pull request branch, and the pull request is reviewed again.
            </DialogDescription>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Button onClick={apply}>Commit {total} fix{total === 1 ? "" : "es"}</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Not now
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
