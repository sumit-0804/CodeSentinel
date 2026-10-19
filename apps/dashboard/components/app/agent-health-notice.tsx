import type { AgentKind, AgentsHealth } from "@code-sentinel/contracts";
import { AGENTS } from "@/components/brand/agents";
import { healthNotice } from "@/lib/agent-health-view";
import { cn } from "@/lib/utils";

const NAMES = Object.fromEntries(AGENTS.map(({ agent, name }) => [agent, name])) as Record<AgentKind, string>;

const TONE = { warn: "border-warn/35 bg-warn/8", crit: "border-crit/35 bg-crit/8" } as const;

/** A banner when an agent isn't healthy (WP6); renders nothing when every agent is fine. */
export function AgentHealthNotice({ health, onlyAgents }: { health: AgentsHealth | undefined; onlyAgents?: readonly AgentKind[] }) {
  const notice = health ? healthNotice(health, NAMES, onlyAgents) : undefined;
  if (!notice) return null;
  return (
    <div role="status" className={cn("grid gap-0.5 rounded-2xl border px-5 py-4", TONE[notice.tone])}>
      <b className="font-bold">{notice.title}</b>
      <span className="text-sm text-ink-2">{notice.body}</span>
    </div>
  );
}
