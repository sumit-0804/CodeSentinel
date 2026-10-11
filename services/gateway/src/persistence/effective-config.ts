import { AgentKindSchema, type AgentKind } from "@code-sentinel/contracts";

import type { EffectiveRepositoryConfig } from "./stores.js";

/** Platform default threshold when neither the repository nor the organization sets one (FR-ORC-06). */
export const PLATFORM_DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

/** Column defaults of `repository_settings`. */
const SETTINGS_DEFAULTS = { agentTimeoutMs: 20000, autoFixStyle: true, postInlineComments: true };

export interface RepositorySettingsInput {
  /** `null` or absent means inherit. */
  confidenceThresholdOverride?: number | null;
  agentTimeoutMs?: number;
  autoFixStyle?: boolean;
  postInlineComments?: boolean;
}

export interface EffectiveConfigInputs {
  /** Absent when the repository has no `repository_settings` row. */
  settings?: RepositorySettingsInput;
  organizationThreshold?: number;
  disabledAgents: ReadonlySet<AgentKind>;
}

/** Resolves UC-4 settings: repository override, then organization default, then platform default. */
export function resolveEffectiveConfig({ settings, organizationThreshold, disabledAgents }: EffectiveConfigInputs): EffectiveRepositoryConfig {
  const threshold: Pick<EffectiveRepositoryConfig, "confidenceThreshold" | "thresholdSource"> =
    settings?.confidenceThresholdOverride != null
      ? { confidenceThreshold: settings.confidenceThresholdOverride, thresholdSource: "repository_override" }
      : organizationThreshold !== undefined
        ? { confidenceThreshold: organizationThreshold, thresholdSource: "organization_default" }
        : { confidenceThreshold: PLATFORM_DEFAULT_CONFIDENCE_THRESHOLD, thresholdSource: "platform_default" };

  return {
    enabledAgents: AgentKindSchema.options.filter((agent) => !disabledAgents.has(agent)),
    ...threshold,
    agentTimeoutMs: settings?.agentTimeoutMs ?? SETTINGS_DEFAULTS.agentTimeoutMs,
    autoFixStyle: settings?.autoFixStyle ?? SETTINGS_DEFAULTS.autoFixStyle,
    postInlineComments: settings?.postInlineComments ?? SETTINGS_DEFAULTS.postInlineComments,
  };
}
