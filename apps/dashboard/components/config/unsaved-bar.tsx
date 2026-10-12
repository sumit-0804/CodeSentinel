"use client";

import { CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";

/** The sticky "Unsaved changes" bar from the mockup; shown only while a draft differs from what's saved. */
export function UnsavedBar({ pending, problem, onDiscard, onSave }: { pending: boolean; problem?: string; onDiscard: () => void; onSave: () => void }) {
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className="fixed bottom-[calc(18px+env(safe-area-inset-bottom,0px))] left-1/2 z-50 flex max-w-[calc(100%-32px)] -translate-x-1/2 flex-wrap items-center gap-x-4 gap-y-2.5 rounded-2xl border border-cyan/35 bg-[rgb(21_24_39/0.95)] py-2.5 pr-2.5 pl-[18px] shadow-[0_0_40px_-12px_rgb(61_240_255/0.6),0_24px_48px_-20px_#000] backdrop-blur-[10px]"
    >
      <CircleDot className="size-4 text-cyan" aria-hidden="true" />
      <b className="font-bold">Unsaved changes</b>
      {problem ? (
        <span role="alert" className="text-[13.5px] text-crit">
          {problem}
        </span>
      ) : null}
      <Button variant="ghost" onClick={onDiscard} disabled={pending}>
        Discard
      </Button>
      <Button variant="default" onClick={onSave} disabled={pending || !!problem}>
        {pending ? <Loader label="Saving" /> : "Save changes"}
      </Button>
    </div>
  );
}
