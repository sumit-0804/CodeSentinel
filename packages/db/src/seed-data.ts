import type { Prisma, PrismaClient } from "./generated/prisma/client.js";
import { SecretBox } from "./secret-box.js";

/**
 * Deterministic UUIDs for the dev seed dataset. The primary organization, installation,
 * repository, and user IDs match `@code-sentinel/contracts/examples` and the gateway's
 * in-memory dev seed (`services/gateway/src/persistence/dev-seed.ts`).
 */
export const SEED_IDS = {
  organizations: {
    codeSentinel: "7d9e1f2a-3b4c-4d5e-8f60-718293a4b5c6",
    acmePayments: "8e0f2a3b-4c5d-4e6f-9a70-8293a4b5c6d7",
  },
  installations: {
    codeSentinel: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
    acmePayments: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  },
  repositories: {
    consumerApi: "2b0c6b0e-0b1a-4f6e-9c3d-1a2b3c4d5e6f",
    checkoutService: "3c1d7c1f-1c2b-4a7f-8d4e-2b3c4d5e6f70",
    settlementEngine: "4d2e8d20-2d3c-4b80-9e5f-3c4d5e6f7081",
  },
  users: {
    octoDev: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
    priyaSec: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f70",
    arjunDev: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7081",
    rileyAcme: "6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f708192",
  },
  sessions: {
    octoLaptop: "11111111-2222-4333-8444-555555555501",
    octoPhone: "11111111-2222-4333-8444-555555555502",
    arjunWorkstation: "11111111-2222-4333-8444-555555555503",
  },
  reviews: {
    pr42CompletedFail: "a0000001-1111-4222-8333-000000000042",
    pr48PartialFail: "a0000002-1111-4222-8333-000000000048",
    pr51ManualPass: "a0000003-1111-4222-8333-000000000051",
    pr42SupersededCancelled: "a0000004-1111-4222-8333-000000000041",
  },
  jobs: {
    pr42CompletedFail: "b0000001-1111-4222-8333-000000000042",
    pr48PartialFail: "b0000002-1111-4222-8333-000000000048",
    pr51ManualPass: "b0000003-1111-4222-8333-000000000051",
    pr42SupersededCancelled: "b0000004-1111-4222-8333-000000000041",
  },
  agentRuns: {
    pr42Security: "c0000042-0001-4000-8000-000000000001",
    pr42Style: "c0000042-0002-4000-8000-000000000002",
    pr42Performance: "c0000042-0003-4000-8000-000000000003",
    pr42Logic: "c0000042-0004-4000-8000-000000000004",
    pr42Documentation: "c0000042-0005-4000-8000-000000000005",
    pr48Security: "c0000048-0001-4000-8000-000000000001",
    pr48Style: "c0000048-0002-4000-8000-000000000002",
    pr48Performance: "c0000048-0003-4000-8000-000000000003",
    pr48LogicTimedOut: "c0000048-0004-4000-8000-000000000004",
    pr48Documentation: "c0000048-0005-4000-8000-000000000005",
    pr51Security: "c0000051-0001-4000-8000-000000000001",
    pr51Style: "c0000051-0002-4000-8000-000000000002",
    pr51Performance: "c0000051-0003-4000-8000-000000000003",
    pr51Logic: "c0000051-0004-4000-8000-000000000004",
    pr51DocumentationSkipped: "c0000051-0005-4000-8000-000000000005",
  },
  findings: {
    pr42HardcodedAwsKey: "d0000042-0001-4000-8000-000000000001",
    pr42SqlInjectionOrders: "d0000042-0002-4000-8000-000000000002",
    pr42SqlInjectionLogicDuplicate: "d0000042-0003-4000-8000-000000000003",
    pr42XssInnerHtml: "d0000042-0004-4000-8000-000000000004",
    pr42DiscountLogicBug: "d0000042-0005-4000-8000-000000000005",
    pr42NPlusOneQuery: "d0000042-0006-4000-8000-000000000006",
    pr42SyncFileRead: "d0000042-0007-4000-8000-000000000007",
    pr42StyleVarEqeqeq: "d0000042-0008-4000-8000-000000000008",
    pr42MissingJsDoc: "d0000042-0009-4000-8000-000000000009",
    pr48SqlInjectionUsers: "d0000048-0001-4000-8000-000000000001",
    pr48UnboundedRetryLoop: "d0000048-0002-4000-8000-000000000002",
    pr51DocstringParamNote: "d0000051-0001-4000-8000-000000000001",
  },
  suggestions: {
    pr42AwsKeyEnvFix: "e0000042-0001-4000-8000-000000000001",
    pr42SqlParameterizedAccepted: "e0000042-0002-4000-8000-000000000002",
    pr42DiscountFixAccepted: "e0000042-0005-4000-8000-000000000005",
    pr42NPlusOneRejected: "e0000042-0006-4000-8000-000000000006",
    pr42StyleDeterministicProposed: "e0000042-0008-4000-8000-000000000008",
    pr48SqlUsersSuperseded: "e0000048-0001-4000-8000-000000000001",
  },
  auditEvents: {
    githubLinked: "f0000001-0001-4000-8000-000000000001",
    installationsSynced: "f0000001-0002-4000-8000-000000000002",
    reviewDefaultsUpdated: "f0000001-0003-4000-8000-000000000003",
    repoConfigUpdated: "f0000001-0004-4000-8000-000000000004",
    fixAccepted: "f0000001-0005-4000-8000-000000000005",
    fixRejected: "f0000001-0006-4000-8000-000000000006",
    fixesApplied: "f0000001-0007-4000-8000-000000000007",
    reviewRerun: "f0000001-0008-4000-8000-000000000008",
    sessionRevoked: "f0000001-0009-4000-8000-000000000009",
    stepUpRefused: "f0000001-0010-4000-8000-000000000010",
  },
} as const;

/** 32-byte deterministic base64 key used when `FIELD_ENCRYPTION_KEY` is unset in local development. */
export const DEFAULT_DEV_ENCRYPTION_KEY = Buffer.from("0123456789abcdef0123456789abcdef", "utf8").toString("base64");

export const EMBEDDING_DIMENSIONS = 768;

export interface SeedDatabaseOptions {
  /** Optional `owner/name:githubRepoId` override for the primary repository (`SEED_GITHUB_REPOSITORY`). */
  repoOverride?: string | undefined;
  /** Optional 32-byte base64 key for `SecretBox` (`FIELD_ENCRYPTION_KEY`). */
  encryptionKey?: string | undefined;
}

export interface SeedDatabaseSummary {
  primaryRepository: string;
  counts: {
    organizations: number;
    users: number;
    organizationMembers: number;
    organizationAgentDefaults: number;
    githubInstallations: number;
    githubUserTokens: number;
    repositories: number;
    repositoryMembers: number;
    repositorySettings: number;
    repositoryAgentConfig: number;
    reviews: number;
    agentRuns: number;
    findings: number;
    suggestions: number;
    findingEmbeddings: number;
    findingSimilarities: number;
    sessionActivity: number;
    auditEvents: number;
  };
}

/** Parses `SEED_GITHUB_REPOSITORY` (`owner/name:githubRepoId`) or returns the default `code-sentinel/consumer-api`. */
export function parseRepositoryOverride(repoOverride?: string): { fullName: string; githubRepoId: bigint } {
  const trimmed = repoOverride?.trim();
  if (!trimmed) {
    return { fullName: "code-sentinel/consumer-api", githubRepoId: 123456789n };
  }
  if (!/^[\w.-]+\/[\w.-]+:\d+$/.test(trimmed)) {
    throw new Error("SEED_GITHUB_REPOSITORY must look like owner/name:githubRepoId");
  }
  const [fullName, idPart] = trimmed.split(":");
  return { fullName: fullName!, githubRepoId: BigInt(idPart!) };
}

/**
 * Generates a normalized 768-dimension embedding vector for `finding_embeddings`.
 * Findings in the same semantic `cluster` receive a high shared basis component so cosine
 * similarity (`1 - (a <=> b)`) exceeds the 0.80 similarity threshold, while findings in different
 * clusters remain nearly orthogonal.
 */
export function buildDeterministicEmbedding(cluster: number, variant = 0): number[] {
  const raw = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, idx) => {
    const baseAxis = (cluster * 97) % EMBEDDING_DIMENSIONS;
    const secondaryAxis = (baseAxis + 1 + variant) % EMBEDDING_DIMENSIONS;
    if (idx === baseAxis) return 0.96;
    if (idx === secondaryAxis) return 0.18;
    return ((idx + cluster * 13 + variant * 7) % 11 - 5) * 0.001;
  });
  const norm = Math.sqrt(raw.reduce((sum, val) => sum + val * val, 0));
  return raw.map((val) => Number((val / norm).toFixed(6)));
}

/** Formats a numeric vector as a pgvector literal (`[v1,v2,...]`). */
export function formatVectorLiteral(vector: readonly number[]): string {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Expected ${EMBEDDING_DIMENSIONS}-dimension vector, got ${vector.length}`);
  }
  return `[${vector.join(",")}]`;
}

/**
 * Populates all 18 tables in the `public` schema with realistic, interconnected multi-agent code
 * review records. Idempotent: safe to run repeatedly on an existing development database.
 */
export async function seedMeaningfulDatabase(
  prisma: PrismaClient,
  options: SeedDatabaseOptions = {},
): Promise<SeedDatabaseSummary> {
  const { fullName, githubRepoId } = parseRepositoryOverride(options.repoOverride);
  const secretBox = new SecretBox(options.encryptionKey ?? DEFAULT_DEV_ENCRYPTION_KEY);

  // 1. Organizations (2 rows: primary Code Sentinel + tenant-isolated Acme Payments)
  await prisma.organization.upsert({
    where: { id: SEED_IDS.organizations.codeSentinel },
    update: { displayName: "Code Sentinel", defaultConfidenceThreshold: 0.8 },
    create: {
      id: SEED_IDS.organizations.codeSentinel,
      githubOrgLogin: "code-sentinel",
      githubOrgId: 1n,
      accountType: "organization",
      displayName: "Code Sentinel",
      defaultConfidenceThreshold: 0.8,
    },
  });

  await prisma.organization.upsert({
    where: { id: SEED_IDS.organizations.acmePayments },
    update: { displayName: "Acme Payments", defaultConfidenceThreshold: 0.85 },
    create: {
      id: SEED_IDS.organizations.acmePayments,
      githubOrgLogin: "acme-payments",
      githubOrgId: 2n,
      accountType: "organization",
      displayName: "Acme Payments",
      defaultConfidenceThreshold: 0.85,
    },
  });

  // 2. Users (4 rows: 2 admins, 1 member, 1 second-org admin)
  const usersData = [
    {
      id: SEED_IDS.users.octoDev,
      githubUserId: 1001n,
      githubLogin: "octo-dev",
      email: "octo-dev@example.test",
      name: "Octo Dev",
      avatarUrl: "https://avatars.githubusercontent.com/u/1001",
      lastSeenAt: new Date("2026-10-31T14:30:00Z"),
    },
    {
      id: SEED_IDS.users.priyaSec,
      githubUserId: 1002n,
      githubLogin: "priya-sec",
      email: "priya.sec@example.test",
      name: "Priya Sharma",
      avatarUrl: "https://avatars.githubusercontent.com/u/1002",
      lastSeenAt: new Date("2026-10-31T12:15:00Z"),
    },
    {
      id: SEED_IDS.users.arjunDev,
      githubUserId: 1003n,
      githubLogin: "arjun-dev",
      email: "arjun.dev@example.test",
      name: "Arjun Patel",
      avatarUrl: "https://avatars.githubusercontent.com/u/1003",
      lastSeenAt: new Date("2026-10-31T11:00:00Z"),
    },
    {
      id: SEED_IDS.users.rileyAcme,
      githubUserId: 2001n,
      githubLogin: "riley-acme",
      email: "riley@acme-payments.test",
      name: "Riley Chen",
      avatarUrl: "https://avatars.githubusercontent.com/u/2001",
      lastSeenAt: new Date("2026-10-30T18:00:00Z"),
    },
  ] as const;

  for (const u of usersData) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: {
        githubUserId: u.githubUserId,
        githubLogin: u.githubLogin,
        email: u.email,
        name: u.name,
        avatarUrl: u.avatarUrl,
        lastSeenAt: u.lastSeenAt,
      },
      create: u,
    });
  }

  // 3. Organization Members (4 rows)
  const memberships = [
    { organizationId: SEED_IDS.organizations.codeSentinel, userId: SEED_IDS.users.octoDev, role: "admin" as const },
    { organizationId: SEED_IDS.organizations.codeSentinel, userId: SEED_IDS.users.priyaSec, role: "admin" as const },
    { organizationId: SEED_IDS.organizations.codeSentinel, userId: SEED_IDS.users.arjunDev, role: "member" as const },
    { organizationId: SEED_IDS.organizations.acmePayments, userId: SEED_IDS.users.rileyAcme, role: "admin" as const },
  ];

  for (const m of memberships) {
    await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: m.organizationId, userId: m.userId } },
      update: { role: m.role },
      create: m,
    });
  }

  // 4. Organization Agent Defaults (5 rows for Code Sentinel)
  const orgAgentModes = [
    { agent: "security" as const, mode: "block" as const },
    { agent: "logic" as const, mode: "block" as const },
    { agent: "performance" as const, mode: "comment" as const },
    { agent: "style" as const, mode: "comment" as const },
    { agent: "documentation" as const, mode: "comment" as const },
  ];

  for (const row of orgAgentModes) {
    await prisma.organizationAgentDefault.upsert({
      where: {
        organizationId_agent: {
          organizationId: SEED_IDS.organizations.codeSentinel,
          agent: row.agent,
        },
      },
      update: { mode: row.mode, updatedBy: SEED_IDS.users.octoDev },
      create: {
        organizationId: SEED_IDS.organizations.codeSentinel,
        agent: row.agent,
        mode: row.mode,
        updatedBy: SEED_IDS.users.octoDev,
      },
    });
  }

  // 5. GitHub Installations (2 rows)
  await prisma.githubInstallation.upsert({
    where: { id: SEED_IDS.installations.codeSentinel },
    update: { accountLogin: "code-sentinel", suspendedAt: null, uninstalledAt: null },
    create: {
      id: SEED_IDS.installations.codeSentinel,
      organizationId: SEED_IDS.organizations.codeSentinel,
      githubInstallationId: 1n,
      accountLogin: "code-sentinel",
    },
  });

  await prisma.githubInstallation.upsert({
    where: { id: SEED_IDS.installations.acmePayments },
    update: { accountLogin: "acme-payments", suspendedAt: null, uninstalledAt: null },
    create: {
      id: SEED_IDS.installations.acmePayments,
      organizationId: SEED_IDS.organizations.acmePayments,
      githubInstallationId: 2n,
      accountLogin: "acme-payments",
    },
  });

  // 6. GitHub User Tokens (2 rows, sealed with AES-256-GCM SecretBox)
  const tokenUsers = [
    {
      userId: SEED_IDS.users.octoDev,
      accessToken: "ghu_seed_octo_dev_access_token_v1",
      refreshToken: "ghr_seed_octo_dev_refresh_token_v1",
    },
    {
      userId: SEED_IDS.users.arjunDev,
      accessToken: "ghu_seed_arjun_dev_access_token_v1",
      refreshToken: "ghr_seed_arjun_dev_refresh_token_v1",
    },
  ];

  for (const t of tokenUsers) {
    const accessTokenSealed = secretBox.seal(t.accessToken);
    const refreshTokenSealed = secretBox.seal(t.refreshToken);
    await prisma.githubUserToken.upsert({
      where: { userId: t.userId },
      update: {
        accessTokenSealed,
        refreshTokenSealed,
        expiresAt: new Date("2026-11-15T00:00:00Z"),
        refreshExpiresAt: new Date("2027-04-15T00:00:00Z"),
      },
      create: {
        userId: t.userId,
        accessTokenSealed,
        refreshTokenSealed,
        expiresAt: new Date("2026-11-15T00:00:00Z"),
        refreshExpiresAt: new Date("2027-04-15T00:00:00Z"),
      },
    });
  }

  // 7. Repositories (3 rows)
  await prisma.repository.upsert({
    where: { id: SEED_IDS.repositories.consumerApi },
    update: {
      githubRepoId,
      fullName,
      defaultBranch: "main",
      primaryLanguage: "TypeScript",
      isPrivate: true,
      reviewEnabled: true,
      useOrgDefaults: false,
      removedAt: null,
    },
    create: {
      id: SEED_IDS.repositories.consumerApi,
      organizationId: SEED_IDS.organizations.codeSentinel,
      githubInstallationId: SEED_IDS.installations.codeSentinel,
      githubRepoId,
      fullName,
      defaultBranch: "main",
      primaryLanguage: "TypeScript",
      isPrivate: true,
      reviewEnabled: true,
      useOrgDefaults: false,
    },
  });

  await prisma.repository.upsert({
    where: { id: SEED_IDS.repositories.checkoutService },
    update: {
      githubRepoId: 123456790n,
      fullName: "code-sentinel/checkout-service",
      defaultBranch: "main",
      primaryLanguage: "Python",
      isPrivate: true,
      reviewEnabled: true,
      useOrgDefaults: true,
      removedAt: null,
    },
    create: {
      id: SEED_IDS.repositories.checkoutService,
      organizationId: SEED_IDS.organizations.codeSentinel,
      githubInstallationId: SEED_IDS.installations.codeSentinel,
      githubRepoId: 123456790n,
      fullName: "code-sentinel/checkout-service",
      defaultBranch: "main",
      primaryLanguage: "Python",
      isPrivate: true,
      reviewEnabled: true,
      useOrgDefaults: true,
    },
  });

  await prisma.repository.upsert({
    where: { id: SEED_IDS.repositories.settlementEngine },
    update: {
      githubRepoId: 223456789n,
      fullName: "acme-payments/settlement-engine",
      defaultBranch: "main",
      primaryLanguage: "TypeScript",
      isPrivate: true,
      reviewEnabled: true,
      useOrgDefaults: true,
      removedAt: null,
    },
    create: {
      id: SEED_IDS.repositories.settlementEngine,
      organizationId: SEED_IDS.organizations.acmePayments,
      githubInstallationId: SEED_IDS.installations.acmePayments,
      githubRepoId: 223456789n,
      fullName: "acme-payments/settlement-engine",
      defaultBranch: "main",
      primaryLanguage: "TypeScript",
      isPrivate: true,
      reviewEnabled: true,
      useOrgDefaults: true,
    },
  });

  // 8. Repository Settings (3 rows)
  await prisma.repositorySetting.upsert({
    where: { repositoryId: SEED_IDS.repositories.consumerApi },
    update: {
      confidenceThresholdOverride: 0.8,
      agentTimeoutMs: 20000,
      autoFixStyle: true,
      postInlineComments: true,
      reviewBranches: ["main", "release/*"],
      updatedBy: SEED_IDS.users.octoDev,
    },
    create: {
      repositoryId: SEED_IDS.repositories.consumerApi,
      confidenceThresholdOverride: 0.8,
      agentTimeoutMs: 20000,
      autoFixStyle: true,
      postInlineComments: true,
      reviewBranches: ["main", "release/*"],
      updatedBy: SEED_IDS.users.octoDev,
    },
  });

  await prisma.repositorySetting.upsert({
    where: { repositoryId: SEED_IDS.repositories.checkoutService },
    update: {
      confidenceThresholdOverride: null,
      agentTimeoutMs: 20000,
      autoFixStyle: true,
      postInlineComments: true,
      reviewBranches: ["main"],
      updatedBy: SEED_IDS.users.priyaSec,
    },
    create: {
      repositoryId: SEED_IDS.repositories.checkoutService,
      confidenceThresholdOverride: null,
      agentTimeoutMs: 20000,
      autoFixStyle: true,
      postInlineComments: true,
      reviewBranches: ["main"],
      updatedBy: SEED_IDS.users.priyaSec,
    },
  });

  await prisma.repositorySetting.upsert({
    where: { repositoryId: SEED_IDS.repositories.settlementEngine },
    update: {
      confidenceThresholdOverride: 0.85,
      agentTimeoutMs: 25000,
      autoFixStyle: true,
      postInlineComments: true,
      reviewBranches: ["main"],
      updatedBy: SEED_IDS.users.rileyAcme,
    },
    create: {
      repositoryId: SEED_IDS.repositories.settlementEngine,
      confidenceThresholdOverride: 0.85,
      agentTimeoutMs: 25000,
      autoFixStyle: true,
      postInlineComments: true,
      reviewBranches: ["main"],
      updatedBy: SEED_IDS.users.rileyAcme,
    },
  });

  // 9. Repository Members (2 rows: member `arjun-dev` has access to `consumer-api` only; `priya-sec` also mapped)
  const repoMembers = [
    { repositoryId: SEED_IDS.repositories.consumerApi, userId: SEED_IDS.users.arjunDev },
    { repositoryId: SEED_IDS.repositories.consumerApi, userId: SEED_IDS.users.priyaSec },
  ];

  for (const rm of repoMembers) {
    await prisma.repositoryMember.upsert({
      where: { repositoryId_userId: rm },
      update: {},
      create: rm,
    });
  }

  // 10. Repository Agent Config (5 rows on `consumer-api`)
  for (const row of orgAgentModes) {
    await prisma.repositoryAgentConfig.upsert({
      where: {
        repositoryId_agent: {
          repositoryId: SEED_IDS.repositories.consumerApi,
          agent: row.agent,
        },
      },
      update: { mode: row.mode, updatedBy: SEED_IDS.users.octoDev },
      create: {
        repositoryId: SEED_IDS.repositories.consumerApi,
        agent: row.agent,
        mode: row.mode,
        updatedBy: SEED_IDS.users.octoDev,
      },
    });
  }

  // Clean existing seeded reviews, session activity, and audit events before recreating so nested child rows stay deterministic
  await prisma.review.deleteMany({
    where: { id: { in: Object.values(SEED_IDS.reviews) } },
  });
  await prisma.sessionActivity.deleteMany({
    where: { sessionId: { in: Object.values(SEED_IDS.sessions) } },
  });
  await prisma.auditEvent.deleteMany({
    where: { id: { in: Object.values(SEED_IDS.auditEvents) } },
  });

  // 11. Reviews (4 rows: completed/fail, partial/fail, completed/pass manual, cancelled superseded)
  const pr42Report: Prisma.InputJsonValue = {
    reviewId: SEED_IDS.reviews.pr42CompletedFail,
    status: "completed",
    summary: {
      criticalCount: 3,
      warningCount: 3,
      infoCount: 2,
      autoFixedCount: 1,
      suggestedFixCount: 4,
    },
    coverage: {
      reviewedFilesCount: 4,
      skippedFilesCount: 1,
    },
    skippedFiles: [{ path: "package-lock.json", reason: "ignored_path" }],
  };

  const pr48Report: Prisma.InputJsonValue = {
    reviewId: SEED_IDS.reviews.pr48PartialFail,
    status: "partial",
    summary: {
      criticalCount: 1,
      warningCount: 1,
      infoCount: 0,
      autoFixedCount: 0,
      suggestedFixCount: 1,
    },
    coverage: {
      reviewedFilesCount: 2,
      skippedFilesCount: 0,
    },
  };

  const pr48Progress: Prisma.InputJsonValue = [
    { agent: "security", status: "succeeded", findingsCount: 1, latencyMs: 3120 },
    { agent: "style", status: "succeeded", findingsCount: 0, latencyMs: 1450 },
    { agent: "performance", status: "succeeded", findingsCount: 1, latencyMs: 4280 },
    { agent: "documentation", status: "succeeded", findingsCount: 0, latencyMs: 2890 },
    { agent: "logic", status: "timed_out", findingsCount: 0, latencyMs: 20000, errorCode: "AGENT_TIMEOUT" },
  ];

  const pr51Report: Prisma.InputJsonValue = {
    reviewId: SEED_IDS.reviews.pr51ManualPass,
    status: "completed",
    summary: {
      criticalCount: 0,
      warningCount: 0,
      infoCount: 1,
      autoFixedCount: 0,
      suggestedFixCount: 0,
    },
    coverage: {
      reviewedFilesCount: 2,
      skippedFilesCount: 0,
    },
  };

  await prisma.review.create({
    data: {
      id: SEED_IDS.reviews.pr42SupersededCancelled,
      jobId: SEED_IDS.jobs.pr42SupersededCancelled,
      idempotencyKey: "seed-delivery-pr42-old",
      deliveryId: "seed-delivery-pr42-old",
      organizationId: SEED_IDS.organizations.codeSentinel,
      repositoryId: SEED_IDS.repositories.consumerApi,
      trigger: "github_pull_request",
      prNumber: 42,
      prTitle: "Add checkout discount and order export endpoints",
      headSha: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a00",
      baseSha: "0000000011111111222222223333333344444444",
      headRef: "feat/checkout-discount",
      baseRef: "main",
      changedFilesCount: 4,
      changedLinesCount: 112,
      status: "cancelled",
      confidenceThreshold: 0.8,
      githubCheckRunId: 9001001n,
      checkConclusion: "neutral",
      durationMs: 4100,
      errorMessage: "Superseded by newer commit 7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e",
      startedAt: new Date("2026-10-28T09:55:00Z"),
      completedAt: new Date("2026-10-28T09:55:04Z"),
      createdAt: new Date("2026-10-28T09:55:00Z"),
    },
  });

  await prisma.review.create({
    data: {
      id: SEED_IDS.reviews.pr42CompletedFail,
      jobId: SEED_IDS.jobs.pr42CompletedFail,
      idempotencyKey: "seed-delivery-pr42-head",
      deliveryId: "seed-delivery-pr42-head",
      organizationId: SEED_IDS.organizations.codeSentinel,
      repositoryId: SEED_IDS.repositories.consumerApi,
      trigger: "github_pull_request",
      prNumber: 42,
      prTitle: "Add checkout discount and order export endpoints",
      headSha: "7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e",
      baseSha: "0000000011111111222222223333333344444444",
      headRef: "feat/checkout-discount",
      baseRef: "main",
      changedFilesCount: 4,
      changedLinesCount: 128,
      status: "completed",
      confidenceThreshold: 0.8,
      githubCheckRunId: 9001002n,
      checkConclusion: "fail",
      durationMs: 6840,
      report: pr42Report,
      startedAt: new Date("2026-10-28T10:00:00Z"),
      completedAt: new Date("2026-10-28T10:00:07Z"),
      createdAt: new Date("2026-10-28T10:00:00Z"),
    },
  });

  await prisma.review.create({
    data: {
      id: SEED_IDS.reviews.pr48PartialFail,
      jobId: SEED_IDS.jobs.pr48PartialFail,
      idempotencyKey: "seed-delivery-pr48-head",
      deliveryId: "seed-delivery-pr48-head",
      organizationId: SEED_IDS.organizations.codeSentinel,
      repositoryId: SEED_IDS.repositories.consumerApi,
      trigger: "github_pull_request",
      prNumber: 48,
      prTitle: "Refactor payment retry queue and user login",
      headSha: "8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b",
      baseSha: "7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e",
      headRef: "feat/payment-retry-queue",
      baseRef: "main",
      changedFilesCount: 2,
      changedLinesCount: 84,
      status: "partial",
      confidenceThreshold: 0.8,
      githubCheckRunId: 9001048n,
      checkConclusion: "fail",
      durationMs: 20150,
      report: pr48Report,
      agentProgress: pr48Progress,
      startedAt: new Date("2026-10-30T15:20:00Z"),
      completedAt: new Date("2026-10-30T15:20:20Z"),
      createdAt: new Date("2026-10-30T15:20:00Z"),
    },
  });

  await prisma.review.create({
    data: {
      id: SEED_IDS.reviews.pr51ManualPass,
      jobId: SEED_IDS.jobs.pr51ManualPass,
      idempotencyKey: "seed-manual-pr51-run1",
      organizationId: SEED_IDS.organizations.codeSentinel,
      repositoryId: SEED_IDS.repositories.checkoutService,
      trigger: "dashboard_manual",
      triggeredByUserId: SEED_IDS.users.octoDev,
      prNumber: 51,
      prTitle: "Fix pagination offset and add route docstrings",
      headSha: "9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c",
      baseSha: "8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b",
      headRef: "fix/pagination-offset",
      baseRef: "main",
      changedFilesCount: 2,
      changedLinesCount: 36,
      status: "completed",
      confidenceThreshold: 0.8,
      githubCheckRunId: 9001051n,
      checkConclusion: "pass",
      durationMs: 4920,
      report: pr51Report,
      startedAt: new Date("2026-10-31T11:10:00Z"),
      completedAt: new Date("2026-10-31T11:10:05Z"),
      createdAt: new Date("2026-10-31T11:10:00Z"),
    },
  });

  // 12. Agent Runs (15 rows across Reviews PR #42, PR #48, PR #51)
  const agentRunsData: Prisma.AgentRunCreateManyInput[] = [
    // PR #42 — all 5 agents succeeded
    {
      id: SEED_IDS.agentRuns.pr42Security,
      reviewId: SEED_IDS.reviews.pr42CompletedFail,
      agent: "security",
      status: "succeeded",
      serviceVersion: "0.1.0",
      llmProvider: "groq",
      llmModel: "openai/gpt-oss-120b",
      llmFallbackDepth: 0,
      findingsCount: 3,
      latencyMs: 3420,
      timeoutMs: 20000,
      attempt: 1,
      startedAt: new Date("2026-10-28T10:00:00Z"),
      finishedAt: new Date("2026-10-28T10:00:03Z"),
    },
    {
      id: SEED_IDS.agentRuns.pr42Style,
      reviewId: SEED_IDS.reviews.pr42CompletedFail,
      agent: "style",
      status: "succeeded",
      serviceVersion: "0.1.0",
      llmProvider: null,
      llmModel: null,
      llmFallbackDepth: 0,
      findingsCount: 1,
      latencyMs: 1680,
      timeoutMs: 20000,
      attempt: 1,
      startedAt: new Date("2026-10-28T10:00:00Z"),
      finishedAt: new Date("2026-10-28T10:00:02Z"),
    },
    {
      id: SEED_IDS.agentRuns.pr42Performance,
      reviewId: SEED_IDS.reviews.pr42CompletedFail,
      agent: "performance",
      status: "succeeded",
      serviceVersion: "0.1.0",
      llmProvider: "gemini",
      llmModel: "gemini-2.5-flash-lite",
      llmFallbackDepth: 1,
      findingsCount: 2,
      latencyMs: 5120,
      timeoutMs: 20000,
      attempt: 1,
      startedAt: new Date("2026-10-28T10:00:00Z"),
      finishedAt: new Date("2026-10-28T10:00:05Z"),
    },
    {
      id: SEED_IDS.agentRuns.pr42Logic,
      reviewId: SEED_IDS.reviews.pr42CompletedFail,
      agent: "logic",
      status: "succeeded",
      serviceVersion: "0.1.0",
      llmProvider: "groq",
      llmModel: "openai/gpt-oss-120b",
      llmFallbackDepth: 0,
      findingsCount: 2,
      latencyMs: 4890,
      timeoutMs: 20000,
      attempt: 1,
      startedAt: new Date("2026-10-28T10:00:00Z"),
      finishedAt: new Date("2026-10-28T10:00:05Z"),
    },
    {
      id: SEED_IDS.agentRuns.pr42Documentation,
      reviewId: SEED_IDS.reviews.pr42CompletedFail,
      agent: "documentation",
      status: "succeeded",
      serviceVersion: "0.1.0",
      llmProvider: "groq",
      llmModel: "openai/gpt-oss-120b",
      llmFallbackDepth: 0,
      findingsCount: 1,
      latencyMs: 2940,
      timeoutMs: 20000,
      attempt: 1,
      startedAt: new Date("2026-10-28T10:00:00Z"),
      finishedAt: new Date("2026-10-28T10:00:03Z"),
    },
    // PR #48 — 4 succeeded + 1 timed_out (Logic Agent)
    {
      id: SEED_IDS.agentRuns.pr48Security,
      reviewId: SEED_IDS.reviews.pr48PartialFail,
      agent: "security",
      status: "succeeded",
      serviceVersion: "0.1.0",
      llmProvider: "groq",
      llmModel: "openai/gpt-oss-120b",
      llmFallbackDepth: 0,
      findingsCount: 1,
      latencyMs: 3120,
      timeoutMs: 20000,
      attempt: 1,
      startedAt: new Date("2026-10-30T15:20:00Z"),
      finishedAt: new Date("2026-10-30T15:20:03Z"),
    },
    {
      id: SEED_IDS.agentRuns.pr48Style,
      reviewId: SEED_IDS.reviews.pr48PartialFail,
      agent: "style",
      status: "succeeded",
      serviceVersion: "0.1.0",
      llmProvider: null,
      llmModel: null,
      llmFallbackDepth: 0,
      findingsCount: 0,
      latencyMs: 1450,
      timeoutMs: 20000,
      attempt: 1,
      startedAt: new Date("2026-10-30T15:20:00Z"),
      finishedAt: new Date("2026-10-30T15:20:01Z"),
    },
    {
      id: SEED_IDS.agentRuns.pr48Performance,
      reviewId: SEED_IDS.reviews.pr48PartialFail,
      agent: "performance",
      status: "succeeded",
      serviceVersion: "0.1.0",
      llmProvider: "groq",
      llmModel: "openai/gpt-oss-120b",
      llmFallbackDepth: 0,
      findingsCount: 1,
      latencyMs: 4280,
      timeoutMs: 20000,
      attempt: 1,
      startedAt: new Date("2026-10-30T15:20:00Z"),
      finishedAt: new Date("2026-10-30T15:20:04Z"),
    },
    {
      id: SEED_IDS.agentRuns.pr48LogicTimedOut,
      reviewId: SEED_IDS.reviews.pr48PartialFail,
      agent: "logic",
      status: "timed_out",
      serviceVersion: "0.1.0",
      llmProvider: "groq",
      llmModel: "openai/gpt-oss-120b",
      llmFallbackDepth: 0,
      findingsCount: 0,
      latencyMs: 20000,
      timeoutMs: 20000,
      attempt: 1,
      errorCode: "AGENT_TIMEOUT",
      errorMessage: "Agent logic exceeded configured timeout of 20000ms",
      startedAt: new Date("2026-10-30T15:20:00Z"),
      finishedAt: new Date("2026-10-30T15:20:20Z"),
    },
    {
      id: SEED_IDS.agentRuns.pr48Documentation,
      reviewId: SEED_IDS.reviews.pr48PartialFail,
      agent: "documentation",
      status: "succeeded",
      serviceVersion: "0.1.0",
      llmProvider: "groq",
      llmModel: "openai/gpt-oss-120b",
      llmFallbackDepth: 0,
      findingsCount: 0,
      latencyMs: 2890,
      timeoutMs: 20000,
      attempt: 1,
      startedAt: new Date("2026-10-30T15:20:00Z"),
      finishedAt: new Date("2026-10-30T15:20:03Z"),
    },
    // PR #51 — manual dashboard review
    {
      id: SEED_IDS.agentRuns.pr51Security,
      reviewId: SEED_IDS.reviews.pr51ManualPass,
      agent: "security",
      status: "succeeded",
      serviceVersion: "0.1.0",
      llmProvider: "groq",
      llmModel: "openai/gpt-oss-120b",
      llmFallbackDepth: 0,
      findingsCount: 0,
      latencyMs: 2100,
      timeoutMs: 20000,
      attempt: 1,
      startedAt: new Date("2026-10-31T11:10:00Z"),
      finishedAt: new Date("2026-10-31T11:10:02Z"),
    },
    {
      id: SEED_IDS.agentRuns.pr51Style,
      reviewId: SEED_IDS.reviews.pr51ManualPass,
      agent: "style",
      status: "succeeded",
      serviceVersion: "0.1.0",
      llmProvider: null,
      llmModel: null,
      llmFallbackDepth: 0,
      findingsCount: 0,
      latencyMs: 1180,
      timeoutMs: 20000,
      attempt: 1,
      startedAt: new Date("2026-10-31T11:10:00Z"),
      finishedAt: new Date("2026-10-31T11:10:01Z"),
    },
    {
      id: SEED_IDS.agentRuns.pr51Performance,
      reviewId: SEED_IDS.reviews.pr51ManualPass,
      agent: "performance",
      status: "succeeded",
      serviceVersion: "0.1.0",
      llmProvider: "groq",
      llmModel: "openai/gpt-oss-120b",
      llmFallbackDepth: 0,
      findingsCount: 0,
      latencyMs: 3200,
      timeoutMs: 20000,
      attempt: 1,
      startedAt: new Date("2026-10-31T11:10:00Z"),
      finishedAt: new Date("2026-10-31T11:10:03Z"),
    },
    {
      id: SEED_IDS.agentRuns.pr51Logic,
      reviewId: SEED_IDS.reviews.pr51ManualPass,
      agent: "logic",
      status: "succeeded",
      serviceVersion: "0.1.0",
      llmProvider: "groq",
      llmModel: "openai/gpt-oss-120b",
      llmFallbackDepth: 0,
      findingsCount: 1,
      latencyMs: 3890,
      timeoutMs: 20000,
      attempt: 1,
      startedAt: new Date("2026-10-31T11:10:00Z"),
      finishedAt: new Date("2026-10-31T11:10:04Z"),
    },
    {
      id: SEED_IDS.agentRuns.pr51DocumentationSkipped,
      reviewId: SEED_IDS.reviews.pr51ManualPass,
      agent: "documentation",
      status: "skipped",
      serviceVersion: "0.1.0",
      llmProvider: null,
      llmModel: null,
      llmFallbackDepth: 0,
      findingsCount: 0,
      latencyMs: 40,
      timeoutMs: 20000,
      attempt: 1,
      errorCode: "llm_quota_exhausted",
      errorMessage: "Deferred: sliding window token quota reserved for higher-priority agents",
      startedAt: new Date("2026-10-31T11:10:00Z"),
      finishedAt: new Date("2026-10-31T11:10:00Z"),
    },
  ];

  await prisma.agentRun.createMany({ data: agentRunsData });

  // 13. Findings (12 rows across all 5 agents, including a clubbed/duplicate finding pair)
  const primaryFindings: Prisma.FindingCreateManyInput[] = [
    {
      id: SEED_IDS.findings.pr42HardcodedAwsKey,
      reviewId: SEED_IDS.reviews.pr42CompletedFail,
      agentRunId: SEED_IDS.agentRuns.pr42Security,
      agent: "security",
      ruleId: "security/hardcoded-secret",
      title: "Hardcoded AWS access key ID in service configuration",
      description: "An AWS access key ID (`AKIA...`) is committed directly in `src/config.ts`. Move credentials to environment variables.",
      filePath: "src/config.ts",
      lineStart: 14,
      lineEnd: 16,
      severity: "critical",
      confidence: 0.98,
      severityRank: 3,
      cweId: "CWE-798",
      dedupeKey: "dedupe_pr42_aws_key_config_14_16",
      duplicateCount: 1,
      createdAt: new Date("2026-10-28T10:00:03Z"),
    },
    {
      id: SEED_IDS.findings.pr42SqlInjectionOrders,
      reviewId: SEED_IDS.reviews.pr42CompletedFail,
      agentRunId: SEED_IDS.agentRuns.pr42Security,
      agent: "security",
      ruleId: "security/sql-injection",
      title: "SQL injection via unparameterized template literal in order lookup",
      description: "`req.query.userId` is interpolated directly into the SQL query string. Use parameterized placeholders (`$1`) to prevent arbitrary SQL execution.",
      filePath: "src/routes/orders.ts",
      lineStart: 27,
      lineEnd: 29,
      severity: "critical",
      confidence: 0.96,
      severityRank: 3,
      cweId: "CWE-89",
      dedupeKey: "dedupe_pr42_sqli_orders_27_29",
      duplicateCount: 2,
      createdAt: new Date("2026-10-28T10:00:03Z"),
    },
    {
      id: SEED_IDS.findings.pr42XssInnerHtml,
      reviewId: SEED_IDS.reviews.pr42CompletedFail,
      agentRunId: SEED_IDS.agentRuns.pr42Security,
      agent: "security",
      ruleId: "security/dom-xss",
      title: "Unescaped query parameter assigned to innerHTML",
      description: "Assigning untrusted search text directly to `element.innerHTML` enables DOM-based Cross-Site Scripting (XSS). Use `textContent` instead.",
      filePath: "public/app.js",
      lineStart: 42,
      lineEnd: 44,
      severity: "warning",
      confidence: 0.88,
      severityRank: 2,
      cweId: "CWE-79",
      dedupeKey: "dedupe_pr42_xss_app_42_44",
      duplicateCount: 1,
      createdAt: new Date("2026-10-28T10:00:03Z"),
    },
    {
      id: SEED_IDS.findings.pr42DiscountLogicBug,
      reviewId: SEED_IDS.reviews.pr42CompletedFail,
      agentRunId: SEED_IDS.agentRuns.pr42Logic,
      agent: "logic",
      ruleId: "logic/incorrect-percentage-scale",
      title: "applyDiscount multiplies by raw percentage instead of dividing by 100",
      description: "`priceCents * (1 - percent)` produces negative totals for any discount > 1%. Divide `percent` by 100 before subtracting.",
      filePath: "src/pricing.ts",
      lineStart: 19,
      lineEnd: 21,
      severity: "critical",
      confidence: 0.94,
      severityRank: 3,
      cweId: "CWE-682",
      dedupeKey: "dedupe_pr42_discount_pricing_19_21",
      duplicateCount: 1,
      createdAt: new Date("2026-10-28T10:00:05Z"),
    },
    {
      id: SEED_IDS.findings.pr42NPlusOneQuery,
      reviewId: SEED_IDS.reviews.pr42CompletedFail,
      agentRunId: SEED_IDS.agentRuns.pr42Performance,
      agent: "performance",
      ruleId: "performance/n-plus-one-query",
      title: "N+1 database query inside order item loop",
      description: "Executing `db.query('SELECT * FROM products WHERE id = $1')` per cart item scales linearly with cart size. Batch-fetch all product IDs with `WHERE id = ANY($1)`.",
      filePath: "src/routes/orders.ts",
      lineStart: 54,
      lineEnd: 60,
      severity: "warning",
      confidence: 0.91,
      severityRank: 2,
      cweId: "CWE-1049",
      dedupeKey: "dedupe_pr42_nplus1_orders_54_60",
      duplicateCount: 1,
      createdAt: new Date("2026-10-28T10:00:05Z"),
    },
    {
      id: SEED_IDS.findings.pr42SyncFileRead,
      reviewId: SEED_IDS.reviews.pr42CompletedFail,
      agentRunId: SEED_IDS.agentRuns.pr42Performance,
      agent: "performance",
      ruleId: "performance/sync-io-in-request",
      title: "Synchronous readFileSync blocks the Node.js event loop in request handler",
      description: "Calling `fs.readFileSync` inside `GET /orders/export` blocks concurrent requests. Use `fs.promises.readFile` or stream the template.",
      filePath: "src/routes/orders.ts",
      lineStart: 88,
      lineEnd: 90,
      severity: "warning",
      confidence: 0.89,
      severityRank: 2,
      dedupeKey: "dedupe_pr42_sync_io_orders_88_90",
      duplicateCount: 1,
      createdAt: new Date("2026-10-28T10:00:05Z"),
    },
    {
      id: SEED_IDS.findings.pr42StyleVarEqeqeq,
      reviewId: SEED_IDS.reviews.pr42CompletedFail,
      agentRunId: SEED_IDS.agentRuns.pr42Style,
      agent: "style",
      ruleId: "eslint/no-var+eqeqeq",
      title: "Replace var declaration with const and use strict equality (===)",
      description: "ESLint flagged `no-var` and `eqeqeq` on adjacent lines in `src/pricing.ts`.",
      filePath: "src/pricing.ts",
      lineStart: 8,
      lineEnd: 11,
      severity: "info",
      confidence: 1.0,
      severityRank: 1,
      dedupeKey: "dedupe_pr42_style_pricing_8_11",
      duplicateCount: 1,
      createdAt: new Date("2026-10-28T10:00:02Z"),
    },
    {
      id: SEED_IDS.findings.pr42MissingJsDoc,
      reviewId: SEED_IDS.reviews.pr42CompletedFail,
      agentRunId: SEED_IDS.agentRuns.pr42Documentation,
      agent: "documentation",
      ruleId: "documentation/missing-jsdoc",
      title: "Exported function applyDiscount is missing JSDoc parameter and return documentation",
      description: "Public pricing helpers should document their units (cents vs. dollars) and percentage range (`0..100`).",
      filePath: "src/pricing.ts",
      lineStart: 18,
      lineEnd: 22,
      severity: "info",
      confidence: 0.86,
      severityRank: 1,
      dedupeKey: "dedupe_pr42_jsdoc_pricing_18_22",
      duplicateCount: 1,
      createdAt: new Date("2026-10-28T10:00:03Z"),
    },
    // PR #48 findings
    {
      id: SEED_IDS.findings.pr48SqlInjectionUsers,
      reviewId: SEED_IDS.reviews.pr48PartialFail,
      agentRunId: SEED_IDS.agentRuns.pr48Security,
      agent: "security",
      ruleId: "security/sql-injection",
      title: "SQL injection via string concatenation in user login query",
      description: "Concatenating `req.body.email` into `SELECT * FROM users WHERE email = '...'` allows authentication bypass and data exfiltration.",
      filePath: "src/routes/users.ts",
      lineStart: 31,
      lineEnd: 33,
      severity: "critical",
      confidence: 0.97,
      severityRank: 3,
      cweId: "CWE-89",
      dedupeKey: "dedupe_pr48_sqli_users_31_33",
      duplicateCount: 1,
      createdAt: new Date("2026-10-30T15:20:03Z"),
    },
    {
      id: SEED_IDS.findings.pr48UnboundedRetryLoop,
      reviewId: SEED_IDS.reviews.pr48PartialFail,
      agentRunId: SEED_IDS.agentRuns.pr48Performance,
      agent: "performance",
      ruleId: "performance/unbounded-retry-loop",
      title: "Unbounded retry loop without backoff jitter can exhaust worker pool",
      description: "Failed payment dispatches are retried in a `while (true)` loop without checking `maxAttempts`, pinning worker connections indefinitely.",
      filePath: "src/workers/retry-queue.ts",
      lineStart: 40,
      lineEnd: 49,
      severity: "warning",
      confidence: 0.91,
      severityRank: 2,
      cweId: "CWE-400",
      dedupeKey: "dedupe_pr48_retry_loop_40_49",
      duplicateCount: 1,
      createdAt: new Date("2026-10-30T15:20:04Z"),
    },
    // PR #51 finding
    {
      id: SEED_IDS.findings.pr51DocstringParamNote,
      reviewId: SEED_IDS.reviews.pr51ManualPass,
      agentRunId: SEED_IDS.agentRuns.pr51Logic,
      agent: "logic",
      ruleId: "logic/page-size-upper-bound",
      title: "Consider clamping pageSize to a maximum limit to avoid large offset scans",
      description: "`paginate(page, pageSize)` validates `page >= 1` but allows arbitrarily large `pageSize` values from query strings.",
      filePath: "app/pagination.py",
      lineStart: 12,
      lineEnd: 15,
      severity: "info",
      confidence: 0.82,
      severityRank: 1,
      dedupeKey: "dedupe_pr51_pagination_bound_12_15",
      duplicateCount: 1,
      createdAt: new Date("2026-10-31T11:10:04Z"),
    },
  ];

  await prisma.finding.createMany({ data: primaryFindings });

  // Secondary clubbed/duplicate finding referencing `pr42SqlInjectionOrders` via `duplicateOf`
  await prisma.finding.create({
    data: {
      id: SEED_IDS.findings.pr42SqlInjectionLogicDuplicate,
      reviewId: SEED_IDS.reviews.pr42CompletedFail,
      agentRunId: SEED_IDS.agentRuns.pr42Logic,
      agent: "logic",
      ruleId: "logic/unvalidated-query-param",
      title: "Unvalidated userId query parameter interpolated into SQL query",
      description: "Flagged by Logic Agent on the same lines as Security Agent's CWE-89 finding and collapsed into the primary finding.",
      filePath: "src/routes/orders.ts",
      lineStart: 27,
      lineEnd: 29,
      severity: "warning",
      confidence: 0.87,
      severityRank: 2,
      cweId: "CWE-89",
      dedupeKey: "dedupe_pr42_sqli_orders_27_29",
      duplicateOf: SEED_IDS.findings.pr42SqlInjectionOrders,
      duplicateCount: 1,
      createdAt: new Date("2026-10-28T10:00:05Z"),
    },
  });

  // 14. Suggestions (6 rows across proposed, accepted, rejected, superseded states)
  const suggestionsData: Prisma.SuggestionCreateManyInput[] = [
    {
      id: SEED_IDS.suggestions.pr42AwsKeyEnvFix,
      findingId: SEED_IDS.findings.pr42HardcodedAwsKey,
      kind: "ai_suggested",
      state: "proposed",
      originalSnippet: 'export const AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";',
      suggestedSnippet: 'export const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID ?? "";',
      explanation: "Read the AWS access key from the environment rather than hardcoding it in source control.",
      postedToGithub: true,
      githubCommentId: 5001001n,
      createdAt: new Date("2026-10-28T10:00:06Z"),
    },
    {
      id: SEED_IDS.suggestions.pr42SqlParameterizedAccepted,
      findingId: SEED_IDS.findings.pr42SqlInjectionOrders,
      kind: "ai_suggested",
      state: "accepted",
      originalSnippet: "const rows = await db.query(`SELECT * FROM orders WHERE user_id = '${req.query.userId}'`);",
      suggestedSnippet: "const rows = await db.query('SELECT * FROM orders WHERE user_id = $1', [req.query.userId]);",
      explanation: "Pass user input as a bound parameter (`$1`) so PostgreSQL treats it strictly as a value.",
      postedToGithub: true,
      githubCommentId: 5001002n,
      resolvedByUserId: SEED_IDS.users.octoDev,
      resolvedAt: new Date("2026-10-28T10:15:00Z"),
      resolutionCommitSha: "e8e9f33a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e",
      createdAt: new Date("2026-10-28T10:00:06Z"),
    },
    {
      id: SEED_IDS.suggestions.pr42DiscountFixAccepted,
      findingId: SEED_IDS.findings.pr42DiscountLogicBug,
      kind: "ai_suggested",
      state: "accepted",
      originalSnippet: "return Math.round(priceCents * (1 - percent));",
      suggestedSnippet: "return Math.round(priceCents * (1 - percent / 100));",
      explanation: "Convert the percentage argument (`0..100`) to a decimal ratio before subtracting from 1.",
      postedToGithub: true,
      githubCommentId: 5001003n,
      resolvedByUserId: SEED_IDS.users.priyaSec,
      resolvedAt: new Date("2026-10-28T10:18:00Z"),
      resolutionCommitSha: "f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
      createdAt: new Date("2026-10-28T10:00:06Z"),
    },
    {
      id: SEED_IDS.suggestions.pr42NPlusOneRejected,
      findingId: SEED_IDS.findings.pr42NPlusOneQuery,
      kind: "ai_suggested",
      state: "rejected",
      originalSnippet: "for (const item of items) {\n  const { rows } = await db.query('SELECT * FROM products WHERE id = $1', [item.productId]);\n}",
      suggestedSnippet: "const { rows } = await db.query('SELECT * FROM products WHERE id = ANY($1::uuid[])', [items.map((i) => i.productId)]);",
      explanation: "Fetch all referenced products in a single round-trip using `ANY($1::uuid[])`.",
      postedToGithub: true,
      githubCommentId: 5001004n,
      resolvedByUserId: SEED_IDS.users.arjunDev,
      resolvedAt: new Date("2026-10-28T10:25:00Z"),
      rejectionReason: "will_fix_manually",
      rejectionComment: "Moving product lookup into the repository layer with DataLoader caching in the next commit.",
      createdAt: new Date("2026-10-28T10:00:06Z"),
    },
    {
      id: SEED_IDS.suggestions.pr42StyleDeterministicProposed,
      findingId: SEED_IDS.findings.pr42StyleVarEqeqeq,
      kind: "deterministic",
      state: "proposed",
      originalSnippet: "var discountTier = tier == 'gold' ? 15 : 5;",
      suggestedSnippet: 'const discountTier = tier === "gold" ? 15 : 5;',
      explanation: "Deterministic ESLint + Prettier fix (`no-var`, `eqeqeq`, double quotes).",
      postedToGithub: true,
      githubCommentId: 5001005n,
      createdAt: new Date("2026-10-28T10:00:06Z"),
    },
    {
      id: SEED_IDS.suggestions.pr48SqlUsersSuperseded,
      findingId: SEED_IDS.findings.pr48SqlInjectionUsers,
      kind: "ai_suggested",
      state: "superseded",
      originalSnippet: 'const res = await db.query("SELECT * FROM users WHERE email = \'" + email + "\'");',
      suggestedSnippet: 'const res = await db.query("SELECT * FROM users WHERE email = $1", [email]);',
      explanation: "Use parameterized query arguments to prevent SQL injection in login handler.",
      postedToGithub: true,
      githubCommentId: 5001048n,
      createdAt: new Date("2026-10-30T15:20:05Z"),
    },
  ];

  await prisma.suggestion.createMany({ data: suggestionsData });

  // 15. Finding Embeddings (4 rows using 768-dim pgvector `::vector`)
  // Cluster 1: SQL Injection findings (PR #42 Orders & PR #48 Users share high cosine similarity)
  // Cluster 2: Loop/Performance findings (PR #42 N+1 & PR #48 Retry Loop)
  const embeddingsToSeed = [
    {
      findingId: SEED_IDS.findings.pr42SqlInjectionOrders,
      organizationId: SEED_IDS.organizations.codeSentinel,
      vector: formatVectorLiteral(buildDeterministicEmbedding(1, 0)),
    },
    {
      findingId: SEED_IDS.findings.pr48SqlInjectionUsers,
      organizationId: SEED_IDS.organizations.codeSentinel,
      vector: formatVectorLiteral(buildDeterministicEmbedding(1, 1)),
    },
    {
      findingId: SEED_IDS.findings.pr42NPlusOneQuery,
      organizationId: SEED_IDS.organizations.codeSentinel,
      vector: formatVectorLiteral(buildDeterministicEmbedding(2, 0)),
    },
    {
      findingId: SEED_IDS.findings.pr48UnboundedRetryLoop,
      organizationId: SEED_IDS.organizations.codeSentinel,
      vector: formatVectorLiteral(buildDeterministicEmbedding(2, 1)),
    },
  ];

  for (const emb of embeddingsToSeed) {
    await prisma.$executeRaw`
      INSERT INTO finding_embeddings (finding_id, organization_id, embedding, embedding_model, indexed_at)
      VALUES (${emb.findingId}::uuid, ${emb.organizationId}::uuid, ${emb.vector}::vector, 'gemini-embedding-2', NOW())
      ON CONFLICT (finding_id) DO UPDATE
        SET embedding = EXCLUDED.embedding,
            embedding_model = EXCLUDED.embedding_model,
            indexed_at = EXCLUDED.indexed_at`;
  }

  // 16. Finding Similarities (2 rows linking PR #48 findings back to historical PR #42 findings)
  await prisma.findingSimilarity.upsert({
    where: {
      findingId_similarFindingId: {
        findingId: SEED_IDS.findings.pr48SqlInjectionUsers,
        similarFindingId: SEED_IDS.findings.pr42SqlInjectionOrders,
      },
    },
    update: { similarityScore: 0.924 },
    create: {
      findingId: SEED_IDS.findings.pr48SqlInjectionUsers,
      similarFindingId: SEED_IDS.findings.pr42SqlInjectionOrders,
      similarityScore: 0.924,
      retrievedAt: new Date("2026-10-30T15:20:05Z"),
    },
  });

  await prisma.findingSimilarity.upsert({
    where: {
      findingId_similarFindingId: {
        findingId: SEED_IDS.findings.pr48UnboundedRetryLoop,
        similarFindingId: SEED_IDS.findings.pr42NPlusOneQuery,
      },
    },
    update: { similarityScore: 0.8615 },
    create: {
      findingId: SEED_IDS.findings.pr48UnboundedRetryLoop,
      similarFindingId: SEED_IDS.findings.pr42NPlusOneQuery,
      similarityScore: 0.8615,
      retrievedAt: new Date("2026-10-30T15:20:05Z"),
    },
  });

  // 17. Session Activity (3 rows) & Audit Events (10 rows)
  const sessionsData: Prisma.SessionActivityCreateManyInput[] = [
    {
      sessionId: SEED_IDS.sessions.octoLaptop,
      userId: SEED_IDS.users.octoDev,
      ip: "203.0.113.42",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36",
      lastSeenAt: new Date("2026-10-31T14:30:00Z"),
    },
    {
      sessionId: SEED_IDS.sessions.octoPhone,
      userId: SEED_IDS.users.octoDev,
      ip: "198.51.100.17",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      lastSeenAt: new Date("2026-10-30T21:10:00Z"),
    },
    {
      sessionId: SEED_IDS.sessions.arjunWorkstation,
      userId: SEED_IDS.users.arjunDev,
      ip: "192.0.2.88",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36",
      lastSeenAt: new Date("2026-10-31T11:00:00Z"),
    },
  ];

  await prisma.sessionActivity.createMany({ data: sessionsData });

  const auditEventsData: Prisma.AuditEventCreateManyInput[] = [
    {
      id: SEED_IDS.auditEvents.githubLinked,
      organizationId: SEED_IDS.organizations.codeSentinel,
      userId: SEED_IDS.users.octoDev,
      action: "github_linked",
      targetType: "user",
      targetId: SEED_IDS.users.octoDev,
      ip: "203.0.113.42",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0",
      requestId: "req-seed-audit-001",
      metadata: { githubLogin: "octo-dev" },
      createdAt: new Date("2026-10-25T09:00:00Z"),
    },
    {
      id: SEED_IDS.auditEvents.installationsSynced,
      organizationId: SEED_IDS.organizations.codeSentinel,
      userId: SEED_IDS.users.octoDev,
      action: "installations_synced",
      targetType: "organization",
      targetId: SEED_IDS.organizations.codeSentinel,
      ip: "203.0.113.42",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0",
      requestId: "req-seed-audit-002",
      metadata: { repositoriesCount: 2 },
      createdAt: new Date("2026-10-25T09:01:00Z"),
    },
    {
      id: SEED_IDS.auditEvents.reviewDefaultsUpdated,
      organizationId: SEED_IDS.organizations.codeSentinel,
      userId: SEED_IDS.users.octoDev,
      action: "review_defaults_updated",
      targetType: "organization",
      targetId: SEED_IDS.organizations.codeSentinel,
      ip: "203.0.113.42",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0",
      requestId: "req-seed-audit-003",
      metadata: { defaultConfidenceThreshold: 0.8, blockingAgents: ["security", "logic"] },
      createdAt: new Date("2026-10-26T14:20:00Z"),
    },
    {
      id: SEED_IDS.auditEvents.repoConfigUpdated,
      organizationId: SEED_IDS.organizations.codeSentinel,
      userId: SEED_IDS.users.octoDev,
      action: "repository_config_updated",
      targetType: "repository",
      targetId: SEED_IDS.repositories.consumerApi,
      ip: "203.0.113.42",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0",
      requestId: "req-seed-audit-004",
      metadata: { useOrgDefaults: false, reviewBranches: ["main", "release/*"] },
      createdAt: new Date("2026-10-27T11:10:00Z"),
    },
    {
      id: SEED_IDS.auditEvents.fixAccepted,
      organizationId: SEED_IDS.organizations.codeSentinel,
      userId: SEED_IDS.users.octoDev,
      action: "fix_accepted",
      targetType: "finding",
      targetId: SEED_IDS.findings.pr42SqlInjectionOrders,
      ip: "203.0.113.42",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0",
      requestId: "req-seed-audit-005",
      metadata: { commitSha: "e8e9f33a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e", prNumber: 42 },
      createdAt: new Date("2026-10-28T10:15:00Z"),
    },
    {
      id: SEED_IDS.auditEvents.fixRejected,
      organizationId: SEED_IDS.organizations.codeSentinel,
      userId: SEED_IDS.users.arjunDev,
      action: "fix_rejected",
      targetType: "finding",
      targetId: SEED_IDS.findings.pr42NPlusOneQuery,
      ip: "192.0.2.88",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1) Chrome/141.0.0.0",
      requestId: "req-seed-audit-006",
      metadata: { reason: "will_fix_manually", prNumber: 42 },
      createdAt: new Date("2026-10-28T10:25:00Z"),
    },
    {
      id: SEED_IDS.auditEvents.fixesApplied,
      organizationId: SEED_IDS.organizations.codeSentinel,
      userId: SEED_IDS.users.priyaSec,
      action: "fixes_applied",
      targetType: "review",
      targetId: SEED_IDS.reviews.pr42CompletedFail,
      ip: "198.51.100.25",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0.0.0",
      requestId: "req-seed-audit-007",
      metadata: { appliedCount: 2, commitSha: "f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0" },
      createdAt: new Date("2026-10-28T10:18:00Z"),
    },
    {
      id: SEED_IDS.auditEvents.reviewRerun,
      organizationId: SEED_IDS.organizations.codeSentinel,
      userId: SEED_IDS.users.octoDev,
      action: "review_rerun",
      targetType: "review",
      targetId: SEED_IDS.reviews.pr51ManualPass,
      ip: "203.0.113.42",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0",
      requestId: "req-seed-audit-008",
      metadata: { repositoryId: SEED_IDS.repositories.checkoutService, prNumber: 51 },
      createdAt: new Date("2026-10-31T11:10:00Z"),
    },
    {
      id: SEED_IDS.auditEvents.sessionRevoked,
      organizationId: SEED_IDS.organizations.codeSentinel,
      userId: SEED_IDS.users.octoDev,
      action: "session_revoked",
      targetType: "session",
      targetId: "11111111-2222-4333-8444-555555555599",
      ip: "203.0.113.42",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0",
      requestId: "req-seed-audit-009",
      metadata: { revokedDeviceIp: "198.51.100.99" },
      createdAt: new Date("2026-10-31T12:00:00Z"),
    },
    {
      id: SEED_IDS.auditEvents.stepUpRefused,
      organizationId: SEED_IDS.organizations.codeSentinel,
      userId: SEED_IDS.users.octoDev,
      action: "step_up_refused",
      targetType: "repository",
      targetId: SEED_IDS.repositories.consumerApi,
      ip: "203.0.113.42",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0",
      requestId: "req-seed-audit-010",
      metadata: { reason: "totp_required", route: "PUT /v1/repositories/:id/config" },
      createdAt: new Date("2026-10-27T11:08:00Z"),
    },
  ];

  await prisma.auditEvent.createMany({ data: auditEventsData });

  return {
    primaryRepository: fullName,
    counts: {
      organizations: 2,
      users: usersData.length,
      organizationMembers: memberships.length,
      organizationAgentDefaults: orgAgentModes.length,
      githubInstallations: 2,
      githubUserTokens: tokenUsers.length,
      repositories: 3,
      repositoryMembers: repoMembers.length,
      repositorySettings: 3,
      repositoryAgentConfig: orgAgentModes.length,
      reviews: 4,
      agentRuns: agentRunsData.length,
      findings: primaryFindings.length + 1,
      suggestions: suggestionsData.length,
      findingEmbeddings: embeddingsToSeed.length,
      findingSimilarities: 2,
      sessionActivity: sessionsData.length,
      auditEvents: auditEventsData.length,
    },
  };
}

/** Removes all rows created by `seedMeaningfulDatabase` (cascades through organizations and users). */
export async function deleteSeededDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.organization.deleteMany({
    where: { id: { in: Object.values(SEED_IDS.organizations) } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: Object.values(SEED_IDS.users) } },
  });
}
