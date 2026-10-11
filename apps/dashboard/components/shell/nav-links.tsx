"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isCurrent, MAIN_NAV, WORKSPACE_NAV } from "./nav";

// Picked by name: icon components can't cross from the server layout to this client component.
const GROUPS = { main: MAIN_NAV, workspace: WORKSPACE_NAV };

export function NavLinks({ group }: { group: keyof typeof GROUPS }) {
  const pathname = usePathname();
  const items = GROUPS[group];
  return (
    <div className="grid gap-[3px]">
      {items.map(({ href, label, icon: Icon }) => {
        const current = isCurrent(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "relative flex h-10 items-center gap-3 rounded-[10px] border border-transparent px-3 text-[14.5px] font-semibold text-ink-2 transition-colors duration-150 hover:bg-panel-2 hover:text-ink",
              current &&
                "border-cyan/20 bg-[linear-gradient(90deg,rgb(61_240_255/0.12),rgb(61_240_255/0)_80%)] text-ink before:absolute before:top-[9px] before:bottom-[9px] before:-left-3 before:w-[3px] before:rounded-r-[3px] before:bg-cyan before:shadow-[0_0_12px_var(--cs-cyan)]",
            )}
          >
            <Icon
              aria-hidden="true"
              className={cn("size-[19px] flex-none", current && "text-cyan drop-shadow-[0_0_6px_rgb(61_240_255/0.7)]")}
            />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
