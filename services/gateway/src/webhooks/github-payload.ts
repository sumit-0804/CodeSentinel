import { z } from "zod";

/** Actions that start a review (FR-GH-01); every other `pull_request` action is acknowledged and ignored. */
export const REVIEW_ACTIONS = ["opened", "synchronize", "reopened"] as const;

const GitRefSchema = z.object({ sha: z.string().min(1), ref: z.string().min(1) });

/** The slice of GitHub's `pull_request` payload the gateway reads; gateway.yaml leaves the rest open. */
export const PullRequestEventSchema = z.object({
  action: z.string(),
  number: z.number().int(),
  pull_request: z.object({
    title: z.string(),
    head: GitRefSchema,
    base: GitRefSchema,
  }),
  repository: z.object({
    id: z.number().int(),
    full_name: z.string(),
    name: z.string(),
    owner: z.object({ login: z.string() }),
  }),
  installation: z.object({ id: z.number().int() }).optional(),
});
export type PullRequestEvent = z.infer<typeof PullRequestEventSchema>;

const InstallationRefSchema = z.object({
  id: z.number().int(),
  account: z.object({ id: z.number().int(), login: z.string(), type: z.string() }).nullable().optional(),
  suspended_at: z.string().nullable().optional(),
});

/** `installation`: the App was installed, removed, suspended, unsuspended, or its permissions changed. */
export const InstallationEventSchema = z.object({
  action: z.string(),
  installation: InstallationRefSchema,
});
export type InstallationEvent = z.infer<typeof InstallationEventSchema>;

/** `installation_repositories`: repositories were added to or removed from an installation. */
export const InstallationRepositoriesEventSchema = z.object({
  action: z.enum(["added", "removed"]),
  installation: InstallationRefSchema,
  repositories_removed: z.array(z.object({ id: z.number().int() })).default([]),
});
export type InstallationRepositoriesEvent = z.infer<typeof InstallationRepositoriesEventSchema>;

/** `check_run` with `requested_action`: someone clicked a button the gateway put on its Check Run. */
export const CheckRunActionEventSchema = z.object({
  action: z.literal("requested_action"),
  check_run: z.object({ id: z.number().int() }),
  requested_action: z.object({ identifier: z.string() }),
  repository: z.object({ id: z.number().int() }),
  sender: z.object({ id: z.number().int(), login: z.string() }),
});
export type CheckRunActionEvent = z.infer<typeof CheckRunActionEventSchema>;

export const isReviewAction = (action: unknown): boolean =>
  typeof action === "string" && (REVIEW_ACTIONS as readonly string[]).includes(action);
