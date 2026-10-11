import type { ReactNode } from "react";

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div>
        <h1 className="text-display text-[clamp(24px,2.8vw,32px)]">{title}</h1>
        {sub ? <p className="mt-2.5 max-w-[62ch] text-[15.5px] text-ink-2">{sub}</p> : null}
      </div>
      {actions}
    </div>
  );
}

/** Names its cause and one next action. */
export function EmptyState({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="panel">
      <div className="grid justify-items-start gap-3 p-[clamp(28px,4vw,48px)]">
        <h2 className="text-display text-[22px] leading-tight">{title}</h2>
        <p className="max-w-[56ch] text-ink-2">{children}</p>
        {actions ? <div className="mt-2 flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </div>
  );
}

export const PageSkeleton = () => (
  <div aria-hidden="true" className="grid gap-[30px]">
    <div className="h-9 w-64 animate-pulse rounded-lg bg-panel-2" />
    <div className="h-[340px] animate-pulse rounded-2xl bg-panel" />
  </div>
);
