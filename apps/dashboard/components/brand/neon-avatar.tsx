"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/** The user's photo, or their DiceBear robot, inside a violet→cyan neon ring; initials if the image fails. */
export function NeonAvatar({
  imageUrl,
  initials,
  label,
  className,
}: {
  imageUrl: string;
  initials: string;
  label: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "inline-grid size-8 flex-none rounded-[10px] bg-[conic-gradient(from_210deg,var(--cs-violet),var(--cs-cyan),var(--cs-violet))] p-[1.5px] shadow-[0_0_12px_-3px_rgb(61_240_255/0.6)]",
        className,
      )}
    >
      <Avatar className="size-full rounded-[8.5px] after:hidden">
        <AvatarImage src={imageUrl} alt="" referrerPolicy="no-referrer" className="rounded-[8.5px]" />
        <AvatarFallback className="rounded-[8.5px] bg-panel-3 text-xs font-bold text-ink">{initials}</AvatarFallback>
      </Avatar>
    </span>
  );
}
