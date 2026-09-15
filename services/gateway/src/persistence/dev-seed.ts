import {
  EXAMPLE_ORGANIZATION_ID,
  EXAMPLE_REPOSITORY_ID,
  exampleChangedFile,
} from "@code-sentinel/contracts/examples";

import { sha256Hex } from "../auth/hash.js";
import type { PullRequestFile } from "../github/github-client.js";
import type { StoreSeed } from "./in-memory.js";

/** Local-only API key for the manual check. Never valid anywhere `GATEWAY_SEED` is `none`. */
export const DEV_API_KEY = "cs_live_dev_00000000";
export const DEV_USER_ID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
export const DEV_GITHUB_REPO_ID = 123456789;

/** Demo data for `GATEWAY_SEED=dev`: one repository with all agents on, one user, and three PR files. */
export function devSeed(): { seed: StoreSeed; pullRequestFiles: PullRequestFile[] } {
  const seed: StoreSeed = {
    organizations: [{ organizationId: EXAMPLE_ORGANIZATION_ID }],
    repositories: [
      {
        repositoryId: EXAMPLE_REPOSITORY_ID,
        organizationId: EXAMPLE_ORGANIZATION_ID,
        githubInstallationId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
        githubRepoId: DEV_GITHUB_REPO_ID,
        fullName: "code-sentinel/consumer-api",
        reviewEnabled: true,
      },
    ],
    repositorySettings: [],
    repositoryAgentConfig: [],
    sessions: [],
    apiKeys: [
      {
        keyId: "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9",
        userId: DEV_USER_ID,
        organizationId: EXAMPLE_ORGANIZATION_ID,
        label: "Local development",
        keyPrefix: DEV_API_KEY.slice(0, 12),
        keyHash: sha256Hex(DEV_API_KEY),
      },
    ],
    users: [
      {
        userId: DEV_USER_ID,
        githubLogin: "octo-dev",
        email: "octo-dev@example.test",
        memberships: [{ organizationId: EXAMPLE_ORGANIZATION_ID, displayName: "Code Sentinel", role: "admin" }],
      },
    ],
  };

  const pullRequestFiles: PullRequestFile[] = [
    { filename: exampleChangedFile.path, status: "modified", patch: exampleChangedFile.patch },
    { filename: "package-lock.json", status: "modified", patch: '@@ -1,3 +1,3 @@\n-  "version": "1.0.0",\n+  "version": "1.0.1",\n' },
    { filename: "logo.png", status: "added" },
  ];

  return { seed, pullRequestFiles };
}
