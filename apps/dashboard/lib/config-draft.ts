import {
  AgentKindSchema,
  ReviewBranchPatternSchema,
  type AgentKind,
  type AgentMode,
  type AgentSetting,
  type RepositoryConfig,
  type RepositoryConfigUpdate,
  type ReviewDefaults,
  type ReviewDefaultsUpdate,
} from "@code-sentinel/contracts";

export type AgentModes = Record<AgentKind, AgentMode>;

const AGENT_KINDS = AgentKindSchema.options;
const MAX_BRANCHES = 20;

/** What the repository page edits before Save. `modes` apply when it doesn't follow the defaults; `reviewBranches` always do. */
export type RepositoryDraft = {
  useOrgDefaults: boolean;
  modes: AgentModes;
  reviewBranches: string[];
  /** null inherits the organization's threshold. */
  thresholdOverride: number | null;
};

export type DefaultsDraft = { modes: AgentModes; threshold: number };

export function modesOf(agents: AgentSetting[]): AgentModes {
  return Object.fromEntries(agents.map(({ agent, mode }) => [agent, mode])) as AgentModes;
}

export function repositoryDraftFrom(config: RepositoryConfig): RepositoryDraft {
  return {
    useOrgDefaults: config.useOrgDefaults,
    modes: modesOf(config.agents),
    reviewBranches: [...config.reviewBranches],
    thresholdOverride: config.confidenceThresholdOverride ?? null,
  };
}

/** Leaving the defaults starts from them, so nothing changes until the user picks something else. */
export function stopFollowingDefaults(draft: RepositoryDraft, defaults: ReviewDefaults): RepositoryDraft {
  return { ...draft, useOrgDefaults: false, modes: modesOf(defaults.agents) };
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((item, i) => item === b[i]);

/**
 * Only what changed. Leaving the defaults sends every agent's mode, because the API has no rows of
 * the repository's own to fall back to. Branches are the repository's own either way.
 */
export function repositoryUpdateFrom(saved: RepositoryConfig, draft: RepositoryDraft): RepositoryConfigUpdate {
  const update: RepositoryConfigUpdate = {};
  const switched = draft.useOrgDefaults !== saved.useOrgDefaults;
  if (switched) update.useOrgDefaults = draft.useOrgDefaults;
  if (!draft.useOrgDefaults) {
    const before = modesOf(saved.agents);
    const agents = AGENT_KINDS.filter((agent) => switched || draft.modes[agent] !== before[agent]).map((agent) => ({ agent, mode: draft.modes[agent] }));
    if (agents.length > 0) update.agents = agents;
  }
  if (!sameList(draft.reviewBranches, saved.reviewBranches)) update.reviewBranches = draft.reviewBranches;
  if (draft.thresholdOverride !== (saved.confidenceThresholdOverride ?? null)) update.confidenceThresholdOverride = draft.thresholdOverride;
  return update;
}

export function defaultsDraftFrom(defaults: ReviewDefaults): DefaultsDraft {
  return { modes: modesOf(defaults.agents), threshold: defaults.confidenceThreshold };
}

export function defaultsUpdateFrom(saved: ReviewDefaults, draft: DefaultsDraft): ReviewDefaultsUpdate {
  const update: ReviewDefaultsUpdate = {};
  const before = modesOf(saved.agents);
  const agents = AGENT_KINDS.filter((agent) => draft.modes[agent] !== before[agent]).map((agent) => ({ agent, mode: draft.modes[agent] }));
  if (agents.length > 0) update.agents = agents;
  if (draft.threshold !== saved.confidenceThreshold) update.confidenceThreshold = draft.threshold;
  return update;
}

export const isEmptyUpdate = (update: object) => Object.keys(update).length === 0;

/** The API refuses a configuration with every agent off; say so before Save. */
export const everyAgentOff = (modes: AgentModes) => AGENT_KINDS.every((agent) => modes[agent] === "off");

/** Why `pattern` can't be added to `existing`, or null when it can. */
export function branchPatternError(pattern: string, existing: readonly string[]): string | null {
  if (existing.includes(pattern)) return "That branch is already listed.";
  if (existing.length >= MAX_BRANCHES) return `Up to ${MAX_BRANCHES} branches.`;
  const parsed = ReviewBranchPatternSchema.safeParse(pattern);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Not a valid branch name.");
}
