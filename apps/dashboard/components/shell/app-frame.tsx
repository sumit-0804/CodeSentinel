"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { PaletteTrigger } from "./command-palette";

/** Sidebar plus main column; below 820px the sidebar becomes a drawer opened from the top bar. */
export function AppFrame({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setNavOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  // Following a link inside the drawer closes it.
  const closeOnLink = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a")) setNavOpen(false);
  };

  return (
    <div className="grid min-h-dvh grid-cols-1 min-[821px]:grid-cols-[256px_minmax(0,1fr)]">
      {navOpen ? (
        <div aria-hidden="true" className="fixed inset-0 z-60 bg-[rgb(3_4_9/0.7)] backdrop-blur-sm min-[821px]:hidden" onClick={() => setNavOpen(false)} />
      ) : null}
      <nav
        id="app-nav"
        aria-label="Main"
        onClick={closeOnLink}
        className={cn(
          "flex flex-col gap-1.5 border-r border-line px-3 py-[18px]",
          "fixed inset-y-0 left-0 z-70 w-[280px] -translate-x-full bg-panel transition-transform duration-200",
          navOpen ? "translate-x-0 shadow-[0_0_60px_#000]" : "max-[820px]:invisible",
          "min-[821px]:sticky min-[821px]:top-0 min-[821px]:z-auto min-[821px]:h-dvh min-[821px]:w-auto min-[821px]:translate-x-0 min-[821px]:bg-[rgb(12_13_22/0.7)] min-[821px]:shadow-none min-[821px]:backdrop-blur-md",
        )}
      >
        {sidebar}
      </nav>
      <div className="min-w-0">
        <div className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-line bg-[rgb(12_13_22/0.9)] px-3 py-2.5 min-[821px]:hidden">
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={navOpen}
            aria-controls="app-nav"
            onClick={() => setNavOpen(true)}
            className="grid size-[38px] place-items-center rounded-[10px] text-ink-2 hover:bg-panel-2 hover:text-ink"
          >
            <Menu className="size-[18px]" aria-hidden="true" />
          </button>
          <Link href="/overview" aria-label="Overview">
            <LogoMark />
          </Link>
          <PaletteTrigger variant="icon" />
        </div>
        <main id="main" className="grid w-full max-w-[1200px] min-w-0 content-start gap-[30px] px-[clamp(16px,4vw,56px)] pt-[34px] pb-[110px]">
          {children}
        </main>
      </div>
    </div>
  );
}
