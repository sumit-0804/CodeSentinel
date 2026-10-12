"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import type { ReviewDefaults } from "@code-sentinel/contracts";
import { saveReviewDefaults } from "@/app/(app)/repositories/actions";
import { AgentModeRows } from "@/components/config/agent-mode-rows";
import { BranchPatterns } from "@/components/config/branch-patterns";
import { ThresholdField } from "@/components/config/threshold-field";
import { UnsavedBar } from "@/components/config/unsaved-bar";
import { defaultsDraftFrom, defaultsUpdateFrom, everyAgentOff, isEmptyUpdate, type DefaultsDraft } from "@/lib/config-draft";

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3.5">
      <div>
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {sub ? <p className="mt-1.5 text-[14.5px] text-ink-2">{sub}</p> : null}
      </div>
      <div className="panel">{children}</div>
    </section>
  );
}

/** Settings → Review defaults: the organization's agent modes, threshold and branches. */
export function ReviewDefaultsSettings({ defaults, organizationName, isAdmin }: { defaults: ReviewDefaults; organizationName: string; isAdmin: boolean }) {
  const [saved, setSaved] = useState(defaults);
  const [draft, setDraft] = useState<DefaultsDraft>(() => defaultsDraftFrom(defaults));
  const [pending, startTransition] = useTransition();

  const update = defaultsUpdateFrom(saved, draft);
  const dirty = !isEmptyUpdate(update);
  const problem = everyAgentOff(draft.modes) ? "Keep at least one agent on." : undefined;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = () =>
    startTransition(async () => {
      const result = await saveReviewDefaults(update);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setSaved(result.saved);
      setDraft(defaultsDraftFrom(result.saved));
      toast.success("Review defaults saved. Repositories that follow them use these from the next review.");
    });

  return (
    <div className="grid gap-[30px] pb-24">
      <p className="text-[15px] text-ink-2">
        New repositories in <b className="text-ink">{organizationName}</b>, and every repository set to &ldquo;Use organization defaults&rdquo;, run with these settings.
      </p>
      {isAdmin ? null : (
        <p className="flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-3 text-sm text-ink-2">
          <Lock className="size-4 text-ink-3" aria-hidden="true" />
          Only organization admins can change the review defaults.
        </p>
      )}
      <Section title="Agents">
        <AgentModeRows
          modes={draft.modes}
          locked={!isAdmin}
          onChange={(agent, mode) => setDraft((current) => ({ ...current, modes: { ...current.modes, [agent]: mode } }))}
        />
      </Section>
      <Section title="Confidence threshold">
        <ThresholdField value={draft.threshold} locked={!isAdmin} onChange={(value) => value !== null && setDraft((current) => ({ ...current, threshold: value }))} />
      </Section>
      <Section title="Branches to review">
        <BranchPatterns patterns={draft.reviewBranches} locked={!isAdmin} onChange={(patterns) => setDraft((current) => ({ ...current, reviewBranches: patterns }))} />
      </Section>
      {dirty && isAdmin ? (
        <UnsavedBar pending={pending} {...(problem ? { problem } : {})} onDiscard={() => setDraft(defaultsDraftFrom(saved))} onSave={save} />
      ) : null}
    </div>
  );
}
