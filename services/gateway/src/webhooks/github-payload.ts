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

export const isReviewAction = (action: unknown): boolean =>
  typeof action === "string" && (REVIEW_ACTIONS as readonly string[]).includes(action);
