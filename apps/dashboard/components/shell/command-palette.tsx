"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Search, UserRound } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { MAIN_NAV, WORKSPACE_NAV } from "./nav";

const PaletteContext = createContext<() => void>(() => {});

/** Ctrl/⌘ K opens "Jump to…". Repositories and pull requests join the list once they exist (A6). */
export function CommandPalette({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );
  const openPalette = useCallback(() => setOpen(true), []);
  const pages = useMemo(
    () => [...MAIN_NAV, ...WORKSPACE_NAV.map((item) => ({ ...item, label: "Account settings", icon: UserRound }))],
    [],
  );

  return (
    <PaletteContext value={openPalette}>
      {children}
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Jump to"
        description="Go to a page, repository or pull request"
        className="w-[min(620px,calc(100%-32px))] max-w-none rounded-[18px]! border border-line-2 bg-panel-2 shadow-[0_0_60px_-20px_rgb(61_240_255/0.5),0_40px_80px_-30px_#000] sm:max-w-none"
      >
        <CommandInput placeholder="Jump to a repository, pull request or page" />
        <CommandList>
          <CommandEmpty>Nothing matches.</CommandEmpty>
          <CommandGroup heading="Go to">
            {pages.map(({ href, label, icon: Icon }) => (
              <CommandItem key={href} value={label} onSelect={() => go(href)}>
                <Icon aria-hidden="true" />
                {label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
        <div className="flex gap-4 border-t border-line px-[18px] py-2.5 text-[12.5px] text-ink-3">
          <span><kbd>↑</kbd> <kbd>↓</kbd> to move</span>
          <span><kbd>Enter</kbd> to open</span>
          <span><kbd>Esc</kbd> to close</span>
        </div>
      </CommandDialog>
    </PaletteContext>
  );
}

export function PaletteTrigger({ variant = "full" }: { variant?: "full" | "icon" }) {
  const openPalette = useContext(PaletteContext);
  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={openPalette}
        aria-label="Jump to"
        className="grid size-[38px] place-items-center rounded-[10px] text-ink-2 hover:bg-panel-2 hover:text-ink"
      >
        <Search className="size-[18px]" aria-hidden="true" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={openPalette}
      className="mt-2 mb-1.5 flex h-[38px] items-center gap-2.5 rounded-[10px] border border-line bg-panel px-2.5 text-sm font-medium text-ink-3 transition-colors hover:border-line-2 hover:text-ink-2"
    >
      <Search className="size-4" aria-hidden="true" />
      Jump to…
      <kbd className="ml-auto">Ctrl K</kbd>
    </button>
  );
}
