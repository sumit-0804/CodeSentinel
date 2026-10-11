import { useId } from "react";
import { cn } from "@/lib/utils";

// Shield holding the five agent lanes; one red, three cyan, one green.
export function LogoMark({ className }: { className?: string }) {
  const gradientId = useId();
  return (
    <svg
      viewBox="0 0 30 34"
      aria-hidden="true"
      className={cn("h-[34px] w-[30px] flex-none drop-shadow-[0_0_8px_rgb(61_240_255/0.55)]", className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9b6cff" />
          <stop offset="1" stopColor="#3df0ff" />
        </linearGradient>
      </defs>
      <path
        d="M15 1.5 28 6v10.5c0 7.6-5.4 13.4-13 16-7.6-2.6-13-8.4-13-16V6z"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="2"
      />
      <rect x="7.5" y="13" width="2.4" height="8" rx="1.2" fill="#ff4d73" />
      <rect x="11.1" y="10" width="2.4" height="13" rx="1.2" fill="#3df0ff" />
      <rect x="14.7" y="8" width="2.4" height="16" rx="1.2" fill="#3df0ff" />
      <rect x="18.3" y="10" width="2.4" height="13" rx="1.2" fill="#3df0ff" />
      <rect x="21.9" y="13" width="2.4" height="8" rx="1.2" fill="#39f5a6" />
    </svg>
  );
}

export function Logo({ className, withWordmark = true }: { className?: string; withWordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-display text-[15px] font-semibold tracking-[-0.01em] text-ink", className)}>
      <LogoMark />
      {withWordmark ? <span className="whitespace-nowrap">code sentinel</span> : <span className="sr-only">Code Sentinel</span>}
    </span>
  );
}
