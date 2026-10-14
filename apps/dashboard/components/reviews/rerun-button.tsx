"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { toast } from "sonner";
import { rerunReview } from "@/app/(app)/pull-requests/actions";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";

/** Starts a new review of the pull request's head commit, then opens it. */
export function RerunButton({
  repositoryId,
  pullRequestNumber,
  label = "Re-run review",
  size = "default",
  disabled = false,
}: {
  repositoryId: string;
  pullRequestNumber: number;
  label?: string;
  size?: "default" | "sm";
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      const result = await rerunReview(repositoryId, pullRequestNumber);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Review started. The verdict appears here and on GitHub in a few seconds.");
      router.push(`/pull-requests/${result.reviewId}`);
    });

  return (
    <Button size={size} onClick={run} disabled={pending || disabled}>
      {pending ? (
        <Loader label="Starting the review" />
      ) : (
        <>
          <RotateCw className="size-[15px]" aria-hidden="true" />
          {label}
        </>
      )}
    </Button>
  );
}
