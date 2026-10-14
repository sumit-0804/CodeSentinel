"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, GitBranch, Lock } from "lucide-react";
import { Tabs } from "radix-ui";
import { toast } from "sonner";
import type { PullRequestListItem, RepositoryConfig, ReviewDefaults } from "@code-sentinel/contracts";
import { saveRepositoryConfig } from "@/app/(app)/repositories/actions";
import { useStepUp } from "@/components/auth/step-up";
import { AgentModeRows } from "@/components/config/agent-mode-rows";
import { BranchPatterns } from "@/components/config/branch-patterns";
import { ThresholdField } from "@/components/config/threshold-field";
import { UnsavedBar } from "@/components/config/unsaved-bar";
import { OpenPullRequests } from "@/components/reviews/open-pull-requests";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  everyAgentOff,
  isEmptyUpdate,
  modesOf,
  repositoryDraftFrom,
  repositoryUpdateFrom,
  stopFollowingDefaults,
  type RepositoryDraft,
} from "@/lib/config-draft";

export type RepositoryTab = "agents" | "pull-requests" | "advanced";

const TAB_CLASS =
  "inline-flex h-8 cursor-pointer items-center gap-[7px] rounded-[9px] px-3 text-[13.5px] font-semibold text-ink-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-cyan/60 disabled:cursor-not-allowed disabled:opacity-50 data-[state=active]:bg-panel-3 data-[state=active]:text-ink data-[state=active]:shadow-[inset_0_0_0_1px_var(--cs-line-2)]";

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {aside}
      </div>
      <div className="panel">{children}</div>
    </section>
  );
}

/** The repository page: reviews on/off, agent modes, threshold and branches (A9 API), saved by an admin. */
export function RepositorySettings({
  config,
  defaults,
  isAdmin,
  initialTab,
  openPullRequests,
  lastConfidences,
}: {
  config: RepositoryConfig;
  defaults: ReviewDefaults;
  isAdmin: boolean;
  initialTab: RepositoryTab;
  /** The repository's open pull requests from GitHub, or why they couldn't be loaded. */
  openPullRequests: { ok: true; pulls: PullRequestListItem[] } | { ok: false; message: string };
  /** Finding confidences of the newest finished review, for the threshold preview. */
  lastConfidences?: number[];
}) {
  const [saved, setSaved] = useState(config);
  const [draft, setDraft] = useState<RepositoryDraft>(() => repositoryDraftFrom(config));
  const [tab, setTab] = useState<RepositoryTab>(initialTab);
  const [pending, startTransition] = useTransition();
  const [toggling, startToggle] = useTransition();
  const withStepUp = useStepUp();

  const update = repositoryUpdateFrom(saved, draft);
  const dirty = !isEmptyUpdate(update);
  const locked = !isAdmin || draft.useOrgDefaults;
  const shownModes = draft.useOrgDefaults ? modesOf(defaults.agents) : draft.modes;
  const shownBranches = draft.useOrgDefaults ? defaults.reviewBranches : draft.reviewBranches;
  const problem = !draft.useOrgDefaults && everyAgentOff(draft.modes) ? "Keep at least one agent on, or switch reviews off instead." : undefined;
  const [owner, name] = saved.fullName.split("/");

  // A reload or a closed tab would lose the draft, so the browser asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const chooseTab = (value: string) => {
    const next = value as RepositoryTab;
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  };

  const save = () =>
    startTransition(async () => {
      const result = await withStepUp(() => saveRepositoryConfig(saved.repositoryId, update));
      if (!result) return;
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setSaved(result.saved);
      setDraft(repositoryDraftFrom(result.saved));
      toast.success("Saved. The next review uses these settings.");
    });

  const setReviews = (on: boolean, undoable = true) =>
    startToggle(async () => {
      const result = await withStepUp(() => saveRepositoryConfig(saved.repositoryId, { reviewEnabled: on }));
      if (!result) return;
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setSaved((current) => ({ ...current, reviewEnabled: result.saved.reviewEnabled }));
      const message = on ? `Reviews are on for ${name}.` : `Reviews are off for ${name}. New pull requests won't be reviewed.`;
      // Longer than the 4 s default, so there's time to reach Undo.
      toast.success(message, undoable ? { duration: 10_000, action: { label: "Undo", onClick: () => setReviews(!on, false) } } : undefined);
    });

  return (
    // minmax(0,1fr) columns let long names and wide rows shrink instead of pushing past a phone screen.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-[30px] pb-24">
      <div>
        <nav aria-label="Breadcrumb" className="mb-2.5 flex flex-wrap items-center gap-1.5 text-[13.5px] text-ink-3">
          <Link href="/repositories" className="font-semibold text-ink-2 hover:text-cyan">
            Repositories
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{name}</span>
        </nav>
        <div className="grid grid-cols-[minmax(0,1fr)] items-end gap-x-8 gap-y-[18px] sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex flex-wrap items-center gap-3.5">
            <span className="grid size-[52px] flex-none place-items-center rounded-[14px] border border-cyan/30 bg-[linear-gradient(135deg,rgb(155_108_255/0.35),rgb(61_240_255/0.25))] font-display text-xl font-bold">
              {(name ?? saved.fullName).charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <h1 className="text-display text-[clamp(24px,2.8vw,32px)] [overflow-wrap:anywhere]">{name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
                <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-line-2 px-2.5 text-[12.5px] font-semibold text-ink-2">
                  <GitBranch className="size-3.5" aria-hidden="true" />
                  {saved.defaultBranch}
                </span>
                <code className="font-mono text-xs">
                  {owner}/{name}
                </code>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-[14px] border border-line bg-panel px-3.5 py-2.5 font-semibold">
            <span>Reviews</span>
            <Switch
              checked={saved.reviewEnabled}
              disabled={!isAdmin || toggling}
              onCheckedChange={(on) => setReviews(on)}
              aria-label={`Review pull requests in ${name}`}
            />
            <span className={saved.reviewEnabled ? "min-w-6" : "min-w-6 text-ink-3"}>{saved.reviewEnabled ? "On" : "Off"}</span>
          </div>
        </div>
      </div>

      {isAdmin ? null : (
        <p className="flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-3 text-sm text-ink-2">
          <Lock className="size-4 text-ink-3" aria-hidden="true" />
          Only organization admins can change these settings.
        </p>
      )}

      <Tabs.Root value={tab} onValueChange={chooseTab} className="grid grid-cols-[minmax(0,1fr)] gap-[30px]">
        <Tabs.List aria-label="Repository sections" className="inline-flex flex-wrap gap-0.5 justify-self-start rounded-xl border border-line bg-panel p-[3px]">
          <Tabs.Trigger value="agents" className={TAB_CLASS}>
            Agents
          </Tabs.Trigger>
          <Tabs.Trigger value="pull-requests" className={TAB_CLASS}>
            Pull requests
            {openPullRequests.ok ? <span className="font-semibold text-ink-3 tabular-nums">{openPullRequests.pulls.length}</span> : null}
          </Tabs.Trigger>
          <Tabs.Trigger value="advanced" className={TAB_CLASS}>
            Advanced
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="agents" className="grid grid-cols-[minmax(0,1fr)] gap-[30px] outline-none">
          <Section title="Which agents run on pull requests">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line px-5 py-4">
              <div>
                <b className="font-bold">Use organization defaults</b>
                <p className="text-sm text-ink-2">
                  {draft.useOrgDefaults
                    ? "This repository follows Settings → Review defaults. Turn this off to choose agents here."
                    : "This repository uses its own choices below."}
                </p>
              </div>
              <Switch
                checked={draft.useOrgDefaults}
                disabled={!isAdmin}
                onCheckedChange={(on) =>
                  setDraft((current) => (on ? { ...current, useOrgDefaults: true } : stopFollowingDefaults(current, defaults)))
                }
                aria-label="Use organization defaults"
              />
            </div>
            <AgentModeRows
              modes={shownModes}
              locked={locked}
              onChange={(agent, mode) => setDraft((current) => ({ ...current, modes: { ...current.modes, [agent]: mode } }))}
            />
          </Section>
          <Section title="How confident a finding must be">
            <ThresholdField
              value={draft.thresholdOverride}
              inherited={defaults.confidenceThreshold}
              locked={!isAdmin}
              onChange={(value) => setDraft((current) => ({ ...current, thresholdOverride: value }))}
              {...(lastConfidences?.length ? { lastConfidences } : {})}
            />
          </Section>
        </Tabs.Content>

        <Tabs.Content value="pull-requests" className="grid grid-cols-[minmax(0,1fr)] gap-[30px] outline-none">
          {!openPullRequests.ok ? (
            <p className="panel p-6 text-ink-2">{openPullRequests.message}</p>
          ) : openPullRequests.pulls.length > 0 ? (
            <OpenPullRequests repositoryId={saved.repositoryId} pulls={openPullRequests.pulls} />
          ) : (
            <p className="panel p-6 text-ink-2">No open pull requests in {name}. Open one and it&apos;s reviewed automatically.</p>
          )}
          <p className="text-[13px] text-ink-3">
            Open pull requests on GitHub. Every review, including closed pull requests, is on the{" "}
            <Link href="/pull-requests" className="font-semibold text-cyan hover:underline">
              Pull requests
            </Link>{" "}
            page.
          </p>
        </Tabs.Content>

        <Tabs.Content value="advanced" className="grid grid-cols-[minmax(0,1fr)] gap-[30px] outline-none">
          <Section
            title="Branches to review"
            aside={draft.useOrgDefaults ? <span className="text-[13px] text-ink-3">From organization defaults</span> : undefined}
          >
            <BranchPatterns
              patterns={shownBranches}
              defaultBranch={saved.defaultBranch}
              locked={locked}
              onChange={(patterns) => setDraft((current) => ({ ...current, reviewBranches: patterns }))}
            />
          </Section>
          <Section title="More">
            <ul className="m-0 list-none p-0">
              <li className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-[18px]">
                <span className="grid gap-0.5">
                  <b>Skip these paths</b>
                  <span className="text-sm text-ink-2">Generated files, lock files and binaries are already skipped.</span>
                </span>
                <Button disabled>Edit (Phase B)</Button>
              </li>
              <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-[18px]">
                <span className="grid gap-0.5">
                  <b>Remove from Code Sentinel</b>
                  <span className="text-sm text-ink-2">Repositories are added and removed on GitHub; review history stays here.</span>
                </span>
                <Button asChild variant="destructive">
                  <a href="/onboarding/github/install">
                    <ExternalLink aria-hidden="true" />
                    Manage on GitHub
                  </a>
                </Button>
              </li>
            </ul>
          </Section>
        </Tabs.Content>
      </Tabs.Root>

      {dirty && isAdmin ? (
        <UnsavedBar pending={pending} {...(problem ? { problem } : {})} onDiscard={() => setDraft(repositoryDraftFrom(saved))} onSave={save} />
      ) : null}
    </div>
  );
}
