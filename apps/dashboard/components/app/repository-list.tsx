"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { GitBranch, Lock, Search } from "lucide-react";
import type { ReviewListItem } from "@code-sentinel/contracts";
import { Lanes } from "@/components/brand/verdict";
import { VerdictPill, verdictWord } from "@/components/brand/verdict-pill";
import { Input } from "@/components/ui/input";
import { lanesOf, verdictOf } from "@/lib/review-view";

export type RepositoryRow = {
  repositoryId: string;
  fullName: string;
  defaultBranch?: string;
  isPrivate?: boolean;
  primaryLanguage?: string;
  reviewEnabled: boolean;
};

/** The organization's repositories with a name filter; each name opens its repository page, each verdict its latest review. */
export function RepositoryList({ repositories, latest }: { repositories: RepositoryRow[]; latest: Record<string, ReviewListItem> }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? repositories.filter((repo) => repo.fullName.toLowerCase().includes(q)) : repositories;
  }, [query, repositories]);
  const reviewed = repositories.filter((repo) => repo.reviewEnabled).length;

  return (
    <div className="grid gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="relative max-w-[360px] min-w-[200px] flex-1">
          <span className="sr-only">Search repositories</span>
          <Search className="pointer-events-none absolute top-3.5 left-3.5 size-[17px] text-ink-3" aria-hidden="true" />
          <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search repositories" className="pl-10" />
        </label>
        <span className="text-sm font-semibold text-ink-3 tabular-nums">
          {reviewed} of {repositories.length} reviewed
        </span>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-[12.5px] font-semibold text-ink-3">
              <th className="border-b border-line px-5 py-3">Repository</th>
              <th className="border-b border-line px-5 py-3">Default branch</th>
              <th className="border-b border-line px-5 py-3">Latest verdict</th>
              <th className="border-b border-line px-5 py-3">Reviews</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((repo) => {
              const [owner, name] = repo.fullName.split("/");
              return (
                <tr key={repo.repositoryId} className="border-b border-line last:border-b-0">
                  <td className="px-5 py-3.5">
                    <div className="flex min-w-[240px] items-center gap-3">
                      <span className="grid size-9 flex-none place-items-center rounded-[10px] border border-line-2 bg-panel-3 font-display text-sm font-bold">
                        {(name ?? repo.fullName).charAt(0).toUpperCase()}
                      </span>
                      <span className="grid min-w-0 gap-0.5">
                        <Link href={`/repositories/${repo.fullName}`} className="truncate font-bold hover:text-cyan focus-visible:text-cyan">
                          {name ?? repo.fullName}
                        </Link>
                        <span className="flex items-center gap-1.5 text-[13px] text-ink-3">
                          {repo.isPrivate ? <Lock className="size-3" aria-label="Private" /> : null}
                          {owner}
                          {repo.primaryLanguage ? ` · ${repo.primaryLanguage}` : ""}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-2">
                      <GitBranch className="size-3.5" aria-hidden="true" />
                      {repo.defaultBranch ?? "main"}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-ink-3">
                    {latest[repo.repositoryId] ? (
                      <Link
                        href={`/pull-requests/${latest[repo.repositoryId]!.reviewId}`}
                        className="inline-flex items-center gap-3"
                        aria-label={`Latest review: ${verdictWord(verdictOf(latest[repo.repositoryId]!))}`}
                      >
                        <Lanes lanes={lanesOf(latest[repo.repositoryId]!.agentResults)} />
                        <VerdictPill verdict={verdictOf(latest[repo.repositoryId]!)} />
                      </Link>
                    ) : (
                      "No pull requests yet"
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={
                        repo.reviewEnabled
                          ? "inline-flex h-[26px] items-center rounded-full border border-pass/40 px-2.5 text-[12.5px] font-bold text-pass"
                          : "inline-flex h-[26px] items-center rounded-full border border-line-2 px-2.5 text-[12.5px] font-bold text-ink-3"
                      }
                    >
                      {repo.reviewEnabled ? "On" : "Off"}
                    </span>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-sm text-ink-2">
                  No repository matches “{query}”.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
