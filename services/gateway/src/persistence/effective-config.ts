import {
  AgentKindSchema,
  type AgentKind,
  type AgentMode,
  type AgentSetting,
  type RepositoryConfig,
  type RepositoryConfigUpdate,
  type ReviewDefaults,
  type ReviewDefaultsUpdate,
} from "@code-sentinel/contracts";

import type { EffectiveRepositoryConfig } from "./stores.js";

/** Platform default threshold when neither the repository nor the organization sets one (FR-ORC-06). */
export const PLATFORM_DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

/** Agent modes when neither the repository nor the organization sets one: only Security can block a merge. */
export const PLATFORM_AGENT_MODES: Readonly<Record<AgentKind, AgentMode>> = {
  security: "block",
  style: "comment",
  performance: "comment",
  logic: "comment",
  documentation: "comment",
};

/** Column defaults of `repository_settings`. */
const SETTINGS_DEFAULTS = { agentTimeoutMs: 20000, autoFixStyle: true, postInlineComments: true };

export type AgentModes = Partial<Record<AgentKind, AgentMode>>;

/** `repository_agent_config` or `organization_agent_defaults` rows as a map. */
export function modesOf(rows: { agent: AgentKind; mode: AgentMode }[]): AgentModes {
  return Object.fromEntries(rows.map(({ agent, mode }) => [agent, mode]));
}

export interface RepositorySettingsInput {
  /** `null` or absent means inherit. */
  confidenceThresholdOverride?: number | null;
  agentTimeoutMs?: number;
  autoFixStyle?: boolean;
  postInlineComments?: boolean;
  reviewBranches?: string[];
}

/** An organization's review defaults; a missing agent or threshold falls back to the platform default. */
export interface OrganizationDefaultsInput {
  threshold?: number;
  modes: AgentModes;
  reviewBranches: string[];
}

/** Everything a repository's configuration is resolved from (UC-4). */
export interface RepositoryConfigInputs {
  repositoryId: string;
  organizationId: string;
  fullName: string;
  defaultBranch: string;
  reviewEnabled: boolean;
  useOrgDefaults: boolean;
  /** Absent when the repository has no `repository_settings` row. */
  settings?: RepositorySettingsInput;
  /** The repository's own `repository_agent_config` rows. */
  repositoryModes: AgentModes;
  organization: OrganizationDefaultsInput;
  updatedAt?: Date;
  updatedBy?: string;
}

/** Each agent's mode: the repository's own rows, or the organization's when it follows the defaults; then the platform's. */
export function resolveAgentSettings(inputs: Pick<RepositoryConfigInputs, "useOrgDefaults" | "repositoryModes" | "organization">): AgentSetting[] {
  const own = inputs.useOrgDefaults ? inputs.organization.modes : inputs.repositoryModes;
  const source = inputs.useOrgDefaults ? "organization_default" : "repository";
  return AgentKindSchema.options.map((agent) => {
    const mode = own[agent];
    return mode ? { agent, mode, source } : { agent, mode: PLATFORM_AGENT_MODES[agent], source: "platform_default" };
  });
}

/** Repository override, then organization default, then platform default (FR-ORC-06). */
function resolveThreshold(inputs: RepositoryConfigInputs): Pick<EffectiveRepositoryConfig, "confidenceThreshold" | "thresholdSource"> {
  const override = inputs.settings?.confidenceThresholdOverride;
  if (override != null) return { confidenceThreshold: override, thresholdSource: "repository_override" };
  if (inputs.organization.threshold !== undefined) {
    return { confidenceThreshold: inputs.organization.threshold, thresholdSource: "organization_default" };
  }
  return { confidenceThreshold: PLATFORM_DEFAULT_CONFIDENCE_THRESHOLD, thresholdSource: "platform_default" };
}

/** The base-branch patterns that apply; nothing set means the default branch only. */
function resolveReviewBranches(inputs: RepositoryConfigInputs): string[] {
  const patterns = inputs.useOrgDefaults ? inputs.organization.reviewBranches : (inputs.settings?.reviewBranches ?? []);
  return patterns.length > 0 ? [...patterns] : [inputs.defaultBranch];
}

/** Resolves UC-4 settings for one review. */
export function resolveEffectiveConfig(inputs: RepositoryConfigInputs): EffectiveRepositoryConfig {
  const agents = resolveAgentSettings(inputs);
  const { settings } = inputs;
  return {
    agentModes: Object.fromEntries(agents.map(({ agent, mode }) => [agent, mode])) as Record<AgentKind, AgentMode>,
    enabledAgents: agents.filter(({ mode }) => mode !== "off").map(({ agent }) => agent),
    blockingAgents: agents.filter(({ mode }) => mode === "block").map(({ agent }) => agent),
    reviewBranches: resolveReviewBranches(inputs),
    ...resolveThreshold(inputs),
    agentTimeoutMs: settings?.agentTimeoutMs ?? SETTINGS_DEFAULTS.agentTimeoutMs,
    autoFixStyle: settings?.autoFixStyle ?? SETTINGS_DEFAULTS.autoFixStyle,
    postInlineComments: settings?.postInlineComments ?? SETTINGS_DEFAULTS.postInlineComments,
  };
}

/** The `GET /v1/repositories/{id}/config` body. */
export function toRepositoryConfig(inputs: RepositoryConfigInputs): RepositoryConfig {
  const effective = resolveEffectiveConfig(inputs);
  return {
    repositoryId: inputs.repositoryId,
    fullName: inputs.fullName,
    defaultBranch: inputs.defaultBranch,
    reviewEnabled: inputs.reviewEnabled,
    useOrgDefaults: inputs.useOrgDefaults,
    agents: resolveAgentSettings(inputs),
    reviewBranches: inputs.settings?.reviewBranches ?? [],
    effectiveReviewBranches: effective.reviewBranches,
    confidenceThresholdOverride: inputs.settings?.confidenceThresholdOverride ?? null,
    effectiveConfidenceThreshold: effective.confidenceThreshold,
    thresholdSource: effective.thresholdSource,
    agentTimeoutMs: effective.agentTimeoutMs,
    autoFixStyle: effective.autoFixStyle,
    postInlineComments: effective.postInlineComments,
    ...(inputs.updatedAt ? { updatedAt: inputs.updatedAt.toISOString() } : {}),
    ...(inputs.updatedBy ? { updatedBy: inputs.updatedBy } : {}),
  };
}

/** The `GET /v1/organizations/{id}/review-defaults` body. */
export function toReviewDefaults(organizationId: string, organization: OrganizationDefaultsInput): ReviewDefaults {
  return {
    organizationId,
    agents: resolveAgentSettings({ useOrgDefaults: true, repositoryModes: {}, organization }),
    confidenceThreshold: organization.threshold ?? PLATFORM_DEFAULT_CONFIDENCE_THRESHOLD,
    reviewBranches: [...organization.reviewBranches],
  };
}

function withModes(modes: AgentModes, updates: { agent: AgentKind; mode: AgentMode }[] = []): AgentModes {
  return { ...modes, ...Object.fromEntries(updates.map(({ agent, mode }) => [agent, mode])) };
}

/** The inputs as they would be after `update`, so a route can check the result before saving it. */
export function applyRepositoryConfigUpdate(inputs: RepositoryConfigInputs, update: RepositoryConfigUpdate): RepositoryConfigInputs {
  const { reviewEnabled, useOrgDefaults, agents, ...settings } = update;
  return {
    ...inputs,
    ...(reviewEnabled !== undefined ? { reviewEnabled } : {}),
    ...(useOrgDefaults !== undefined ? { useOrgDefaults } : {}),
    repositoryModes: withModes(inputs.repositoryModes, agents),
    settings: { ...inputs.settings, ...settings },
  };
}

export function applyReviewDefaultsUpdate(organization: OrganizationDefaultsInput, update: ReviewDefaultsUpdate): OrganizationDefaultsInput {
  const threshold = update.confidenceThreshold ?? organization.threshold;
  return {
    ...(threshold !== undefined ? { threshold } : {}),
    modes: withModes(organization.modes, update.agents),
    reviewBranches: update.reviewBranches ?? organization.reviewBranches,
  };
}
