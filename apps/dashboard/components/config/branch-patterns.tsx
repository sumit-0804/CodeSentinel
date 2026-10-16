"use client";

import { useId, useState, type FormEvent } from "react";
import { ChevronsUpDown, GitBranch, Plus, X } from "lucide-react";
import { Popover } from "radix-ui";
import type { BranchListResponse } from "@code-sentinel/contracts";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { branchPatternError } from "@/lib/config-draft";

/** A searchable list of the repository's branches; typed text that isn't a branch is offered as a pattern. */
function BranchPicker({
  branches,
  defaultBranch,
  taken,
  describedBy,
  onPick,
}: {
  branches: BranchListResponse;
  defaultBranch?: string;
  taken: string[];
  /** The error's id while one is shown. */
  describedBy?: string;
  onPick: (pattern: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const ordered =
    defaultBranch && branches.items.includes(defaultBranch) ? [defaultBranch, ...branches.items.filter((b) => b !== defaultBranch)] : branches.items;
  const choices = ordered.filter((branch) => !taken.includes(branch));

  const toggle = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };
  const pick = (pattern: string) => {
    onPick(pattern);
    toggle(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={toggle}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-describedby={describedBy}
          className={cn(
            "flex h-11 w-full max-w-[320px] cursor-pointer items-center gap-2 rounded-xl border border-line-2 bg-panel px-3.5 text-sm font-medium text-ink-3 outline-none transition-[border-color,box-shadow] duration-150 hover:text-ink-2 focus-visible:border-cyan focus-visible:shadow-glow",
            describedBy && "border-crit",
          )}
        >
          <GitBranch className="size-4" aria-hidden="true" />
          Add a branch or pattern
          <ChevronsUpDown className="ml-auto size-4" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-xl border border-line-2 bg-panel-2 shadow-[0_0_40px_-16px_rgb(61_240_255/0.5),0_30px_60px_-30px_#000]"
        >
          <Command loop className="bg-transparent">
            <CommandInput value={query} onValueChange={setQuery} placeholder="Search branches or type a pattern" maxLength={100} className="font-mono text-[13px]" />
            <CommandList>
              <CommandEmpty>{typed ? "No branch matches." : "Every branch is already in the list."}</CommandEmpty>
              {choices.length > 0 ? (
                <CommandGroup heading="Branches">
                  {choices.map((branch) => (
                    <CommandItem key={branch} value={branch} onSelect={() => pick(branch)} className="font-mono text-xs">
                      <GitBranch aria-hidden="true" />
                      <span className="truncate">{branch}</span>
                      {branch === defaultBranch ? (
                        <span className="rounded-full border border-line-2 px-1.5 font-sans text-[11px] text-ink-3">default</span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {typed && !branches.items.includes(typed) ? (
                // Last, so Enter picks a matching branch first; forceMount keeps it past cmdk's filter.
                <CommandGroup forceMount>
                  <CommandItem value={`pattern ${typed}`} forceMount onSelect={() => pick(typed)}>
                    <Plus aria-hidden="true" />
                    Add pattern <code className="font-mono text-xs">{typed}</code>
                  </CommandItem>
                </CommandGroup>
              ) : null}
            </CommandList>
            {branches.truncated ? (
              <p className="border-t border-line px-3 py-2 text-[12.5px] text-ink-3">
                Showing the first {branches.items.length} branches; type a name or pattern to add others.
              </p>
            ) : null}
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Base branches a pull request must merge into to be reviewed. An empty list means the default
 * branch only; `locked` shows the list without editing (following the organization defaults).
 */
export function BranchPatterns({
  patterns,
  defaultBranch,
  branches,
  locked,
  onChange,
}: {
  patterns: string[];
  /** Shown when the list is empty; undefined for the organization defaults (each repository's own). */
  defaultBranch?: string;
  /** The repository's branches to pick from; without them a name is typed. */
  branches?: BranchListResponse;
  locked: boolean;
  onChange: (patterns: string[]) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();

  const add = (pattern: string) => {
    const problem = branchPatternError(pattern, patterns);
    if (problem) {
      setError(problem);
      return;
    }
    onChange([...patterns, pattern]);
    setValue("");
    setError(null);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) add(value.trim());
  };
  const suggestions = [defaultBranch, "release/*", "**"].filter((s): s is string => !!s && !patterns.includes(s));

  return (
    <div className="grid gap-3.5 p-5">
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Branches to review">
        {patterns.length === 0 ? (
          <li className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-dashed border-line-2 px-2.5 text-[13px] text-ink-2">
            <GitBranch className="size-3.5" aria-hidden="true" />
            {defaultBranch ? (
              <>
                Default branch only (<code className="font-mono text-xs">{defaultBranch}</code>)
              </>
            ) : (
              "Each repository's default branch"
            )}
          </li>
        ) : null}
        {patterns.map((pattern) => (
          <li key={pattern} className="inline-flex h-8 items-center gap-1 rounded-[9px] border border-cyan/35 bg-cyan/8 pr-1 pl-2.5 font-mono text-xs text-ink">
            {pattern === "**" ? "** (every branch)" : pattern}
            {locked ? null : (
              <button
                type="button"
                onClick={() => onChange(patterns.filter((p) => p !== pattern))}
                aria-label={`Stop reviewing ${pattern}`}
                className="grid size-6 cursor-pointer place-items-center rounded-md text-ink-3 hover:bg-panel-3 hover:text-ink"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {locked ? null : (
        <>
          {branches ? (
            <BranchPicker branches={branches} taken={patterns} onPick={add} {...(defaultBranch ? { defaultBranch } : {})} {...(error ? { describedBy: errorId } : {})} />
          ) : (
            <form onSubmit={submit} className="flex flex-wrap items-start gap-2.5">
              <label htmlFor={inputId} className="sr-only">
                Add a branch or pattern
              </label>
              <Input
                id={inputId}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError(null);
                }}
                placeholder="main, release/*, hotfix/**"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className="max-w-[280px] flex-1 font-mono text-[13px]"
                maxLength={100}
              />
              <Button type="submit" disabled={!value.trim()}>
                <Plus aria-hidden="true" />
                Add
              </Button>
            </form>
          )}
          {error ? (
            <p id={errorId} role="alert" className="-mt-1 text-[13px] text-crit">
              {error}
            </p>
          ) : null}
          {suggestions.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
              <span>Suggestions:</span>
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => add(s)}
                  className="h-7 cursor-pointer rounded-lg border border-line-2 px-2 font-mono text-xs text-ink-2 hover:border-cyan/40 hover:text-ink"
                >
                  {s === "**" ? "** every branch" : s}
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
      <p className="text-[13px] text-ink-3">
        A pull request is reviewed when the branch it merges into matches one of these. <code className="font-mono">*</code> matches one part of a
        name (<code className="font-mono">release/*</code>), <code className="font-mono">**</code> any number. Names are case-sensitive.
      </p>
    </div>
  );
}
