import { ReviewJobRequestSchema } from "@code-sentinel/contracts";
import { EXAMPLE_ORGANIZATION_ID, EXAMPLE_REPOSITORY_ID, exampleChangedFile } from "@code-sentinel/contracts/examples";
import { describe, expect, it } from "vitest";

import type { EffectiveRepositoryConfig } from "../persistence/stores.js";
import { baseSeed, pullRequestEventPayload } from "../test-support/fixtures.js";
import { PullRequestEventSchema } from "./github-payload.js";
import { buildReviewJobRequest } from "./review-job-request.js";

const CONFIG: EffectiveRepositoryConfig = {
  enabledAgents: ["security", "logic"],
  confidenceThreshold: 0.9,
  thresholdSource: "repository_override",
  agentTimeoutMs: 30000,
  autoFixStyle: true,
  postInlineComments: true,
};

const build = (skippedFiles = [{ path: "package-lock.json", reason: "generated_file" as const }]) =>
  buildReviewJobRequest({
    repository: baseSeed().repositories[0]!,
    config: CONFIG,
    event: PullRequestEventSchema.parse(pullRequestEventPayload()),
    filtered: { files: [exampleChangedFile], skippedFiles },
  });

describe("buildReviewJobRequest", () => {
  it("builds a valid job with the trigger, tenant ids, pull request and SHAs", () => {
    const request = ReviewJobRequestSchema.parse(build());

    expect(request).toMatchObject({
      repositoryId: EXAMPLE_REPOSITORY_ID,
      organizationId: EXAMPLE_ORGANIZATION_ID,
      trigger: "github_pull_request",
      pullRequest: { number: 42, title: "Retry failed payments", headRef: "fix/retry", baseRef: "main" },
      headSha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      baseSha: "0123456789abcdef0123456789abcdef01234567",
      files: [exampleChangedFile],
      skippedFiles: [{ path: "package-lock.json", reason: "generated_file" }],
    });
  });

  it("omits skippedFiles when nothing was skipped", () => {
    expect(build([])).not.toHaveProperty("skippedFiles");
  });

  it("takes agents, threshold and timeout from the effective config", () => {
    expect(build()).toMatchObject({ enabledAgents: ["security", "logic"], confidenceThreshold: 0.9, agentTimeoutMs: 30000 });
  });
});
