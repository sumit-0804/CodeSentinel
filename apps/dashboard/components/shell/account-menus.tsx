"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
import { signOut } from "@/app/(app)/settings/actions";
import { NeonAvatar } from "@/components/brand/neon-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ShellUser = {
  displayName: string;
  email: string | null;
  /** GitHub/Google photo, or a DiceBear robot (data URI) for email accounts. */
  avatarUrl: string;
  initials: string;
  signedInWith: string;
};

const pickerClass =
  "flex w-full items-center gap-2.5 rounded-xl border border-transparent p-2 text-left text-sm font-bold text-ink hover:border-line hover:bg-panel-2 data-[state=open]:border-line data-[state=open]:bg-panel-2";
// z-80 keeps menus above the mobile drawer (z-70).
const menuClass = "z-80 w-(--radix-dropdown-menu-trigger-width) rounded-[14px] border-line-2 bg-panel-2 p-1.5 shadow-[0_24px_48px_-16px_rgb(0_0_0/0.8)]";

function OrgBadge({ letter, small }: { letter: string; small?: boolean }) {
  return (
    <span
      className={
        small
          ? "grid size-6 flex-none place-items-center rounded-[7px] bg-[linear-gradient(135deg,var(--cs-violet),var(--cs-cyan))] font-display text-[11px] font-bold text-[#070812]"
          : "grid size-8 flex-none place-items-center rounded-[9px] bg-[linear-gradient(135deg,var(--cs-violet),var(--cs-cyan))] font-display text-[13px] font-bold text-[#070812]"
      }
    >
      {letter}
    </span>
  );
}

/** Only the personal space exists until GitHub onboarding (A6) adds organizations. */
export function OrgSwitcher({ user }: { user: ShellUser }) {
  const letter = user.initials.charAt(0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={pickerClass}>
        <OrgBadge letter={letter} />
        <span className="min-w-0">
          <span className="block truncate">{user.displayName}</span>
          <span className="block text-[12.5px] font-medium text-ink-3">Personal account</span>
        </span>
        <ChevronDown className="ml-auto size-[15px] flex-none text-ink-3" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={menuClass}>
        <DropdownMenuItem className="gap-2.5 font-semibold">
          <OrgBadge letter={letter} small />
          <span className="truncate">{user.displayName}</span>
          <Check className="ml-auto size-[15px] text-cyan" aria-hidden="true" />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Add a GitHub organization (soon)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UserAvatar({ user, className }: { user: ShellUser; className?: string }) {
  return (
    <NeonAvatar
      imageUrl={user.avatarUrl}
      initials={user.initials}
      label={`${user.displayName}'s avatar`}
      className={className}
    />
  );
}

export function UserMenu({ user }: { user: ShellUser }) {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={pickerClass}>
        <UserAvatar user={user} />
        <span className="min-w-0">
          <span className="block truncate">{user.displayName}</span>
          <span className="block truncate text-[12.5px] font-medium text-ink-3">Signed in with {user.signedInWith}</span>
        </span>
        <ChevronDown className="ml-auto size-[15px] flex-none text-ink-3" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className={menuClass}>
        <DropdownMenuItem asChild className="font-semibold">
          <Link href="/settings">Account settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="font-semibold"
          disabled={pending}
          onSelect={() => startTransition(() => signOut("local"))}
        >
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
