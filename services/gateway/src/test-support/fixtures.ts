import type { ReviewJob } from "@code-sentinel/contracts";
import { EXAMPLE_ORGANIZATION_ID, EXAMPLE_REPOSITORY_ID, EXAMPLE_REVIEW_ID } from "@code-sentinel/contracts/examples";

import { sha256Hex } from "../auth/hash.js";
import { signSessionToken } from "../auth/session-token.js";
import type { AppDeps } from "../app.js";
import type { GatewayConfig } from "../config.js";
import { createJsonLogger, noopLogger, type Logger } from "../logging/logger.js";
import type { OrchestratorClientLike } from "../orchestrator/orchestrator-client.js";
import { InMemoryStores, type StoreSeed } from "../persistence/in-memory.js";

export const TEST_JWT_SECRET = "test-jwt-secret-0123456789abcdef-0123";
export const TEST_USER_ID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
export const TEST_SESSION_ID = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";
export const TEST_API_KEY = "cs_live_test_0123456789abcdef";
export const TEST_API_KEY_ID = "6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b9c";
export const TEST_GITHUB_REPO_ID = 123456789;

/** A valid `GatewayConfig` with dummy secrets. Never a real secret, never port 3000. */
export function testConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    port: 0,
    orchestratorUrl: "http://orchestrator.test:8080",
    orchestratorTimeoutMs: 1000,
    serviceToken: "test-service-token",
    jwtSecret: TEST_JWT_SECRET,
    githubWebhookSecret: "test-webhook-secret",
    seed: "none",
    ...overrides,
  };
}

/** A real JSON logger whose lines are captured and parsed, for tests that assert on logging. */
export function captureLogger(): { logger: Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const logger = createJsonLogger({
    write: (chunk: string) => lines.push(JSON.parse(chunk) as Record<string, unknown>),
  });
  return { logger, lines };
}

/** One organization, one repository with every agent enabled, one user. No credentials. */
export function baseSeed(): StoreSeed {
  return {
    organizations: [{ organizationId: EXAMPLE_ORGANIZATION_ID }],
    repositories: [
      {
        repositoryId: EXAMPLE_REPOSITORY_ID,
        organizationId: EXAMPLE_ORGANIZATION_ID,
        githubInstallationId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
        githubRepoId: TEST_GITHUB_REPO_ID,
        fullName: "code-sentinel/consumer-api",
        reviewEnabled: true,
      },
    ],
    repositorySettings: [],
    repositoryAgentConfig: [],
    sessions: [],
    apiKeys: [],
    users: [
      {
        userId: TEST_USER_ID,
        githubLogin: "octo-dev",
        email: "octo-dev@example.test",
        memberships: [{ organizationId: EXAMPLE_ORGANIZATION_ID, displayName: "Code Sentinel", role: "admin" }],
      },
    ],
  };
}

export interface SeededStores {
  stores: InMemoryStores;
  seed: StoreSeed;
  /** Plaintext of the seeded active API key. */
  apiKey: string;
  /** Plaintext `cs_session` JWT of the seeded active session. */
  sessionToken: string;
}

/**
 * `baseSeed()` plus one active session and one active API key whose plaintexts the test knows.
 * `edit` adjusts the seed (revoke a key, disable an agent) before the stores are built.
 */
export async function seededStores(edit: (seed: StoreSeed) => void = () => {}): Promise<SeededStores> {
  const seed = baseSeed();
  const sessionToken = await signSessionToken(
    { userId: TEST_USER_ID, organizationId: EXAMPLE_ORGANIZATION_ID, sessionId: TEST_SESSION_ID },
    TEST_JWT_SECRET,
  );
  seed.sessions.push({
    sessionId: TEST_SESSION_ID,
    userId: TEST_USER_ID,
    organizationId: EXAMPLE_ORGANIZATION_ID,
    tokenHash: sha256Hex(sessionToken),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  seed.apiKeys.push({
    keyId: TEST_API_KEY_ID,
    userId: TEST_USER_ID,
    organizationId: EXAMPLE_ORGANIZATION_ID,
    label: "VS Code",
    keyPrefix: TEST_API_KEY.slice(0, 12),
    keyHash: sha256Hex(TEST_API_KEY),
  });
  edit(seed);
  return { stores: new InMemoryStores(seed), seed, apiKey: TEST_API_KEY, sessionToken };
}

export const TEST_JOB_ID = "0f7e2c1a-9b3d-4e5f-8a6b-1c2d3e4f5a6b";

/** A `ReviewJob` body as the orchestrator returns it with 202 (new) or 200 (existing). */
export function reviewJobResponse(status: 200 | 202): ReviewJob {
  return {
    jobId: TEST_JOB_ID,
    reviewId: EXAMPLE_REVIEW_ID,
    status: status === 202 ? "queued" : "running",
    createdAt: "2026-09-15T10:29:40Z",
  };
}

/** An orchestrator fake that reports healthy and would start a new job. */
export function fakeOrchestrator(overrides: Partial<OrchestratorClientLike> = {}): OrchestratorClientLike {
  return {
    health: async () => ({ status: "ok", version: "test" }),
    createReviewJob: async () => ({ job: reviewJobResponse(202), created: true }),
    ...overrides,
  };
}

/** Complete `AppDeps` for route tests: test config, silent logger, fake orchestrator, empty stores. */
export function testAppDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    config: testConfig(),
    logger: noopLogger,
    orchestrator: fakeOrchestrator(),
    stores: new InMemoryStores(),
    ...overrides,
  };
}
