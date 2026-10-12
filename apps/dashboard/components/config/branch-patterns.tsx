"use client";

import { useId, useState, type FormEvent } from "react";
import { GitBranch, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { branchPatternError } from "@/lib/config-draft";

/**
 * Base branches a pull request must merge into to be reviewed. An empty list means the default
 * branch only; `locked` shows the list without editing (following the organization defaults).
 */
export function BranchPatterns({
  patterns,
  defaultBranch,
  locked,
  onChange,
}: {
  patterns: string[];
  /** Shown when the list is empty; undefined for the organization defaults (each repository's own). */
  defaultBranch?: string;
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
