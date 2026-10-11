import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { OrgSwitcher, UserMenu } from "@/components/shell/account-menus";
import { AppFrame } from "@/components/shell/app-frame";
import { CommandPalette, PaletteTrigger } from "@/components/shell/command-palette";
import { NavLinks } from "@/components/shell/nav-links";
import { requireUser } from "@/lib/auth";
import { toShellUser } from "@/lib/shell-user";

const PickerSkeleton = () => <div className="h-[50px] animate-pulse rounded-xl bg-panel-2/60" />;

async function SignedInOrg() {
  return <OrgSwitcher user={toShellUser(await requireUser())} />;
}

async function SignedInUser() {
  return <UserMenu user={toShellUser(await requireUser())} />;
}

// The sidebar is static and prerendered; only the parts that name the user wait for the session.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <CommandPalette>
      <AppFrame
        sidebar={
          <>
            <Link href="/overview" className="self-start rounded-md px-2 pt-0.5 pb-3">
              <Logo />
            </Link>
            <Suspense fallback={<PickerSkeleton />}>
              <SignedInOrg />
            </Suspense>
            <PaletteTrigger />
            <NavLinks group="main" />
            <div className="px-3 pt-3.5 pb-1 text-[11.5px] font-semibold tracking-[0.02em] text-ink-3">Workspace</div>
            <NavLinks group="workspace" />
            <div className="flex-1" />
            <Suspense fallback={<PickerSkeleton />}>
              <SignedInUser />
            </Suspense>
          </>
        }
      >
        {children}
      </AppFrame>
    </CommandPalette>
  );
}
