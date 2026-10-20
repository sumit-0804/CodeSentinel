import { randomInt, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { SeedReview, StoreSeed } from "../persistence/in-memory.js";
import { GithubAccountTakenError, type Stores } from "../persistence/stores.js";

/** A seed with fresh ids, so the contract can run against a shared database without touching other rows. */
export function uniqueSeed() {
  const organizationId = randomUUID();
  const repositoryId = randomUUID();
  const userId = randomUUID();
  const installationId = randomUUID();
  const githubRepoId = randomInt(1, 2 ** 47);
  const githubOrgId = randomInt(1, 2 ** 47);
  const githubInstallationId = randomInt(1, 2 ** 47);
  const orgLogin = `test-org-${githubOrgId}`;

  const seed: StoreSeed = {
    organizations: [
      { organizationId, defaultConfidenceThreshold: 0.75, githubOrgId, login: orgLogin, accountType: "organization", displayName: "Test Org" },
    ],
    installations: [{ installationId, organizationId, githubInstallationId, accountLogin: orgLogin }],
    repositories: [
      {
        repositoryId,
        organizationId,
        githubInstallationId: installationId,
        githubRepoId,
        fullName: `${orgLogin}/repo-${githubRepoId}`,
        reviewEnabled: true,
        defaultBranch: "main",
        isPrivate: true,
      },
    ],
    repositorySettings: [],
    repositoryAgentConfig: [],
    organizationAgentDefaults: [],
    reviews: [],
    suggestions: [],
    activeSessionIds: [],
    githubTokens: [],
    users: [
      {
        userId,
        githubLogin: `octo-${githubRepoId}`,
        email: `user-${userId}@example.test`,
        memberships: [{ organizationId, displayName: "Test Org", role: "admin" }],
      },
    ],
  };
  return {
    seed,
    ids: { organizationId, repositoryId, userId, githubRepoId, installationId, githubInstallationId, githubOrgId, orgLogin },
  };
}

type UniqueSeed = ReturnType<typeof uniqueSeed>;

/** Rows a case created outside its seed, for implementations that must delete them afterwards. */
export interface CreatedRows {
  userIds?: string[];
  githubOrgIds?: number[];
}

/**
 * The behaviour every `Stores` implementation must share. `makeStores` builds stores holding exactly
 * `seed` (plus whatever unrelated rows already exist). `cleanUp` removes rows a case created itself;
 * `sessions: false` skips the session cases where active sessions cannot be seeded (a real Supabase project).
 */
export function describeStoresContract(
  makeStores: (seed: StoreSeed) => Promise<Stores>,
  options: { sessions: boolean; cleanUp?: (rows: CreatedRows) => Promise<void> } = { sessions: true },
): void {
  const { cleanUp } = options;
  async function build(edit: (s: UniqueSeed) => void = () => {}) {
    const unique = uniqueSeed();
    edit(unique);
    return { stores: await makeStores(unique.seed), ...unique };
  }

  describe("repositories", () => {
    it("finds a repository by GitHub repo id and misses an unknown one", async () => {
      const { stores, ids, seed } = await build();

      const { repositoryId, organizationId, githubInstallationId, fullName, reviewEnabled } = seed.repositories[0]!;
      await expect(stores.repositories.findByGithubRepoId(ids.githubRepoId)).resolves.toEqual({
        repositoryId,
        organizationId,
        githubInstallationId,
        githubInstallationNumber: ids.githubInstallationId,
        githubRepoId: ids.githubRepoId,
        fullName,
        reviewEnabled,
      });
      await expect(stores.repositories.findByGithubRepoId(ids.githubRepoId + 1)).resolves.toBeUndefined();
    });

    it("finds a repository by id only within its own organization", async () => {
      const { stores, ids } = await build();

      await expect(stores.repositories.findForOrganization(ids.organizationId, ids.repositoryId)).resolves.toMatchObject({
        repositoryId: ids.repositoryId,
        githubInstallationNumber: ids.githubInstallationId,
      });
      await expect(stores.repositories.findForOrganization(randomUUID(), ids.repositoryId)).resolves.toBeUndefined();
      await expect(stores.repositories.findForOrganization(ids.organizationId, randomUUID())).resolves.toBeUndefined();
    });
  });

  describe("repositoryConfig", () => {
    it("uses the repository override when one is set", async () => {
      const { stores, ids } = await build(({ seed, ids }) => {
        seed.repositorySettings.push({ repositoryId: ids.repositoryId, confidenceThresholdOverride: 0.9 });
      });

      await expect(stores.repositoryConfig.getEffectiveConfig(ids.repositoryId)).resolves.toMatchObject({
        confidenceThreshold: 0.9,
        thresholdSource: "repository_override",
      });
    });

    it("falls back to the organization default and the settings defaults", async () => {
      const { stores, ids } = await build(({ seed, ids }) => {
        seed.repositorySettings.push({ repositoryId: ids.repositoryId, confidenceThresholdOverride: null });
      });

      await expect(stores.repositoryConfig.getEffectiveConfig(ids.repositoryId)).resolves.toEqual({
        agentModes: { security: "block", style: "comment", performance: "comment", logic: "comment", documentation: "comment" },
        enabledAgents: ["security", "style", "performance", "logic", "documentation"],
        blockingAgents: ["security"],
        reviewBranches: ["main"],
        confidenceThreshold: 0.75,
        thresholdSource: "organization_default",
        agentTimeoutMs: 20000,
        autoFixStyle: true,
        postInlineComments: true,
      });
    });

    it("returns the stored settings", async () => {
      const { stores, ids } = await build(({ seed, ids }) => {
        seed.repositorySettings.push({
          repositoryId: ids.repositoryId,
          agentTimeoutMs: 45000,
          autoFixStyle: false,
          postInlineComments: false,
        });
      });

      await expect(stores.repositoryConfig.getEffectiveConfig(ids.repositoryId)).resolves.toMatchObject({
        agentTimeoutMs: 45000,
        autoFixStyle: false,
        postInlineComments: false,
      });
    });

    it("uses the repository's own modes and branches when it doesn't follow the defaults", async () => {
      const { stores, ids } = await build(({ seed, ids }) => {
        seed.repositories[0]!.useOrgDefaults = false;
        seed.repositoryAgentConfig.push(
          { repositoryId: ids.repositoryId, agent: "logic", mode: "block" },
          { repositoryId: ids.repositoryId, agent: "style", mode: "off" },
        );
        seed.repositorySettings.push({ repositoryId: ids.repositoryId, reviewBranches: ["main", "release/*"] });
        seed.organizationAgentDefaults.push({ organizationId: ids.organizationId, agent: "security", mode: "comment" });
      });

      const config = await stores.repositoryConfig.getEffectiveConfig(ids.repositoryId);

      expect(config?.enabledAgents).toEqual(["security", "performance", "logic", "documentation"]);
      expect(config?.blockingAgents).toEqual(["security", "logic"]);
      expect(config?.reviewBranches).toEqual(["main", "release/*"]);
    });

    it("uses the organization's modes but the repository's own branches when it follows the defaults", async () => {
      const { stores, ids } = await build(({ seed, ids }) => {
        seed.repositorySettings.push({ repositoryId: ids.repositoryId, reviewBranches: ["develop"] });
        seed.organizationAgentDefaults.push({ organizationId: ids.organizationId, agent: "security", mode: "comment" });
        seed.repositoryAgentConfig.push({ repositoryId: ids.repositoryId, agent: "logic", mode: "block" });
      });

      const config = await stores.repositoryConfig.getEffectiveConfig(ids.repositoryId);

      expect(config?.blockingAgents).toEqual([]);
      expect(config?.agentModes.security).toBe("comment");
      expect(config?.reviewBranches).toEqual(["develop"]);
    });

    it("returns undefined for an unknown repository", async () => {
      const { stores } = await build();

      await expect(stores.repositoryConfig.getEffectiveConfig(randomUUID())).resolves.toBeUndefined();
      await expect(stores.repositoryConfig.getConfigInputs(randomUUID())).resolves.toBeUndefined();
      await expect(stores.repositoryConfig.getReviewDefaults(randomUUID())).resolves.toBeUndefined();
    });

    it("saves a partial update and keeps what it doesn't mention", async () => {
      const { stores, ids } = await build(({ seed, ids }) => {
        seed.repositorySettings.push({ repositoryId: ids.repositoryId, agentTimeoutMs: 45000 });
      });

      await stores.repositoryConfig.updateConfig(
        ids.repositoryId,
        { useOrgDefaults: false, agents: [{ agent: "style", mode: "off" }], reviewBranches: ["release/*"], confidenceThresholdOverride: 0.9 },
        ids.userId,
      );
      await stores.repositoryConfig.updateConfig(ids.repositoryId, { agents: [{ agent: "style", mode: "block" }], reviewEnabled: false }, ids.userId);

      const inputs = await stores.repositoryConfig.getConfigInputs(ids.repositoryId);
      expect(inputs).toMatchObject({
        useOrgDefaults: false,
        reviewEnabled: false,
        repositoryModes: { style: "block" },
        settings: { agentTimeoutMs: 45000, reviewBranches: ["release/*"], confidenceThresholdOverride: 0.9 },
        updatedBy: ids.userId,
      });
      expect(inputs?.updatedAt).toBeInstanceOf(Date);
    });

    it("hides a removed repository's configuration", async () => {
      const { stores, ids } = await build(({ seed }) => {
        seed.repositories[0]!.removedAt = new Date();
      });

      await expect(stores.repositoryConfig.getConfigInputs(ids.repositoryId)).resolves.toBeUndefined();
    });

    it("reads and updates the organization's review defaults", async () => {
      const { stores, ids } = await build();

      await expect(stores.repositoryConfig.getReviewDefaults(ids.organizationId)).resolves.toEqual({ threshold: 0.75, modes: {} });

      await stores.repositoryConfig.updateReviewDefaults(
        ids.organizationId,
        { agents: [{ agent: "security", mode: "comment" }], confidenceThreshold: 0.6 },
        ids.userId,
      );
      await stores.repositoryConfig.updateReviewDefaults(ids.organizationId, { agents: [{ agent: "logic", mode: "block" }] }, ids.userId);

      await expect(stores.repositoryConfig.getReviewDefaults(ids.organizationId)).resolves.toEqual({
        threshold: 0.6,
        modes: { security: "comment", logic: "block" },
      });
    });
  });

  describe("reviews", () => {
    const review = (ids: UniqueSeed["ids"], prNumber: number, minutesAgo: number, overrides: Partial<SeedReview> = {}): SeedReview => ({
      reviewId: randomUUID(),
      organizationId: ids.organizationId,
      repositoryId: ids.repositoryId,
      trigger: "github_pull_request",
      prNumber,
      prTitle: `PR ${prNumber}`,
      headSha: randomUUID().replaceAll("-", "").slice(0, 40),
      status: "completed",
      confidenceThreshold: 0.8,
      createdAt: new Date(Date.now() - minutesAgo * 60_000),
      ...overrides,
    });

    it("lists the organization's reviews newest first, pages them, and keeps each PR's newest with latest", async () => {
      let reviews: SeedReview[] = [];
      const { stores, ids, seed } = await build(({ seed, ids }) => {
        reviews = [review(ids, 7, 30), review(ids, 7, 10, { prTitle: "PR 7 again" }), review(ids, 8, 20, { status: "running" })];
        seed.reviews.push(...reviews);
      });

      const all = await stores.reviews.list(ids.organizationId, { latest: false, limit: 2, offset: 0 });
      expect(all.total).toBe(3);
      expect(all.rows.map((r) => r.reviewId)).toEqual([reviews[1]!.reviewId, reviews[2]!.reviewId]);
      expect(all.rows[0]).toMatchObject({ repositoryFullName: seed.repositories[0]!.fullName, prTitle: "PR 7 again", confidenceThreshold: 0.8 });

      const latest = await stores.reviews.list(ids.organizationId, { latest: true, limit: 25, offset: 0 });
      expect(latest.total).toBe(2);
      expect(latest.rows.map((r) => r.prNumber)).toEqual([7, 8]);

      const running = await stores.reviews.list(ids.organizationId, { status: ["running"], latest: false, limit: 25, offset: 0 });
      expect(running.rows.map((r) => r.prNumber)).toEqual([8]);
    });

    it("counts a dashboard re-run as a pull request's newest review, and leaves out reviews without a pull request", async () => {
      let rerun: SeedReview | undefined;
      const { stores, ids } = await build(({ seed, ids }) => {
        rerun = review(ids, 7, 5, { trigger: "dashboard_manual" });
        const { prNumber: _pr, prTitle: _title, ...noPullRequest } = review(ids, 0, 1, { trigger: "dashboard_manual" });
        seed.reviews.push(review(ids, 7, 30), rerun, noPullRequest);
      });

      const latest = await stores.reviews.list(ids.organizationId, { latest: true, limit: 25, offset: 0 });

      expect(latest.rows.map((r) => r.reviewId)).toEqual([rerun!.reviewId]);
      expect(latest.total).toBe(1);
    });

    it("never shows another organization's reviews", async () => {
      let theirId = "";
      const theirs = await build(({ seed, ids }) => {
        const r = review(ids, 1, 1);
        theirId = r.reviewId;
        seed.reviews.push(r);
      });
      const mine = await build();

      await expect(theirs.stores.reviews.get(mine.ids.organizationId, theirId)).resolves.toBeUndefined();
      await expect(theirs.stores.reviews.list(mine.ids.organizationId, { latest: false, limit: 25, offset: 0 })).resolves.toEqual({ rows: [], total: 0 });
      await expect(theirs.stores.reviews.get(theirs.ids.organizationId, theirId)).resolves.toMatchObject({ prNumber: 1 });
    });

    it("records the Check Run's conclusion, and ignores an unknown review", async () => {
      let reviewId = "";
      const { stores, ids } = await build(({ seed, ids }) => {
        const r = review(ids, 3, 1);
        reviewId = r.reviewId;
        seed.reviews.push(r);
      });

      await stores.reviews.recordCheckRun(reviewId, { checkRunId: 4242, conclusion: "fail" });
      await stores.reviews.recordCheckRun(randomUUID(), { checkRunId: 1, conclusion: "pass" });

      await expect(stores.reviews.get(ids.organizationId, reviewId)).resolves.toMatchObject({ checkConclusion: "fail" });
    });

    it("finds a review by its Check Run id", async () => {
      // Unique per run: the Postgres contract tests share one database.
      const checkRunId = 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
      const { stores, ids } = await build(({ seed, ids }) => {
        seed.reviews.push(review(ids, 9, 1, { githubCheckRunId: checkRunId }));
      });

      await expect(stores.reviews.findByCheckRun(checkRunId)).resolves.toMatchObject({ organizationId: ids.organizationId, prNumber: 9 });
      await expect(stores.reviews.findByCheckRun(checkRunId + 1)).resolves.toBeUndefined();
    });

    it("finds a pull request's queued and running reviews, and only that pull request's", async () => {
      let running: SeedReview | undefined;
      let queued: SeedReview | undefined;
      const { stores, ids } = await build(({ seed, ids }) => {
        running = review(ids, 5, 3, { status: "running", jobId: randomUUID() });
        queued = review(ids, 5, 1, { status: "queued", jobId: randomUUID() });
        seed.reviews.push(
          running,
          queued,
          review(ids, 5, 9, { status: "completed", jobId: randomUUID() }),
          review(ids, 6, 2, { status: "running", jobId: randomUUID() }),
        );
      });

      const active = await stores.reviews.activeForPullRequest(ids.repositoryId, 5);

      expect(active.map((r) => r.reviewId).sort()).toEqual([running!.reviewId, queued!.reviewId].sort());
      expect(active.find((r) => r.reviewId === running!.reviewId)).toEqual({
        reviewId: running!.reviewId,
        jobId: running!.jobId,
        headSha: running!.headSha,
        createdAt: running!.createdAt,
      });
      await expect(stores.reviews.activeForPullRequest(ids.repositoryId, 99)).resolves.toEqual([]);
    });
  });

  describe("suggestions", () => {
    /** One completed review of PR 9 with one proposed AI fix. */
    function withSuggestion({ seed, ids }: UniqueSeed) {
      const reviewId = randomUUID();
      const headSha = randomUUID().replaceAll("-", "").slice(0, 40);
      seed.reviews.push({
        reviewId,
        organizationId: ids.organizationId,
        repositoryId: ids.repositoryId,
        trigger: "github_pull_request",
        prNumber: 9,
        headSha,
        status: "completed",
        confidenceThreshold: 0.8,
        createdAt: new Date(),
      });
      const suggestion = {
        suggestionId: randomUUID(),
        findingId: randomUUID(),
        reviewId,
        agent: "security" as const,
        ruleId: "security/sql-injection",
        title: "SQL built from string formatting",
        filePath: "app/payments.py",
        lineStart: 14,
        lineEnd: 14,
        kind: "ai_suggested" as const,
        state: "proposed" as const,
        originalSnippet: "cur.execute(f\"...{c}\")",
        suggestedSnippet: "cur.execute(\"... ?\", (c,))",
      };
      seed.suggestions.push(suggestion);
      return { suggestion, reviewId, headSha };
    }

    it("lists a review's suggestions with their finding and review, and finds one by finding only in its organization", async () => {
      let fixture!: ReturnType<typeof withSuggestion>;
      const { stores, ids } = await build((unique) => (fixture = withSuggestion(unique)));

      const [listed] = await stores.suggestions.forReview(fixture.reviewId);
      expect(listed).toEqual({
        ...fixture.suggestion,
        organizationId: ids.organizationId,
        repositoryId: ids.repositoryId,
        prNumber: 9,
        headSha: fixture.headSha,
      });
      await expect(stores.suggestions.findByFinding(ids.organizationId, fixture.suggestion.findingId)).resolves.toEqual(listed);
      await expect(stores.suggestions.findByFinding(randomUUID(), fixture.suggestion.findingId)).resolves.toBeUndefined();
      await expect(stores.suggestions.findByFinding(ids.organizationId, randomUUID())).resolves.toBeUndefined();
    });

    it("records posted comment ids", async () => {
      let fixture!: ReturnType<typeof withSuggestion>;
      const { stores, ids } = await build((unique) => (fixture = withSuggestion(unique)));

      await stores.suggestions.recordPosted([{ suggestionId: fixture.suggestion.suggestionId, commentId: 987654321 }]);

      await expect(stores.suggestions.findByFinding(ids.organizationId, fixture.suggestion.findingId)).resolves.toMatchObject({ githubCommentId: 987654321 });
    });

    it("records one decision only: accept with the commit, then any later decision is refused", async () => {
      let fixture!: ReturnType<typeof withSuggestion>;
      const { stores, ids } = await build((unique) => (fixture = withSuggestion(unique)));
      const at = new Date("2026-10-14T10:00:00.000Z");
      const { suggestionId, findingId } = fixture.suggestion;

      await expect(stores.suggestions.accept(suggestionId, { userId: ids.userId, commitSha: "c".repeat(40), at })).resolves.toBe(true);
      await expect(stores.suggestions.reject(suggestionId, { userId: ids.userId, reason: "other", at })).resolves.toBe(false);
      await expect(stores.suggestions.accept(suggestionId, { userId: ids.userId, at })).resolves.toBe(false);

      await expect(stores.suggestions.findByFinding(ids.organizationId, findingId)).resolves.toMatchObject({
        state: "accepted",
        resolutionCommitSha: "c".repeat(40),
        resolvedAt: at,
      });
    });

    it("refuses to accept an AI fix without the person who accepted it", async () => {
      let fixture!: ReturnType<typeof withSuggestion>;
      const { stores, ids } = await build((unique) => (fixture = withSuggestion(unique)));
      const at = new Date("2026-10-17T10:00:00.000Z");

      await expect(stores.suggestions.accept(fixture.suggestion.suggestionId, { commitSha: "c".repeat(40), at })).resolves.toBe(false);

      await expect(stores.suggestions.findByFinding(ids.organizationId, fixture.suggestion.findingId)).resolves.toMatchObject({ state: "proposed" });
    });

    it("accepts an exact fix without a person, as the Check Run button does", async () => {
      let fixture!: ReturnType<typeof withSuggestion>;
      const { stores, ids } = await build((unique) => {
        fixture = withSuggestion(unique);
        Object.assign(fixture.suggestion, { agent: "style", ruleId: "style/prettier", kind: "deterministic" });
      });
      const at = new Date("2026-10-17T10:00:00.000Z");

      await expect(stores.suggestions.accept(fixture.suggestion.suggestionId, { commitSha: "c".repeat(40), at })).resolves.toBe(true);

      await expect(stores.suggestions.findByFinding(ids.organizationId, fixture.suggestion.findingId)).resolves.toMatchObject({ state: "accepted" });
    });

    it("records a rejection with its reason", async () => {
      let fixture!: ReturnType<typeof withSuggestion>;
      const { stores, ids } = await build((unique) => (fixture = withSuggestion(unique)));
      const at = new Date("2026-10-14T10:00:00.000Z");

      await expect(
        stores.suggestions.reject(fixture.suggestion.suggestionId, { userId: ids.userId, reason: "false_positive", comment: "test code", at }),
      ).resolves.toBe(true);

      await expect(stores.suggestions.findByFinding(ids.organizationId, fixture.suggestion.findingId)).resolves.toMatchObject({
        state: "rejected",
        rejectionReason: "false_positive",
        resolvedAt: at,
      });
    });
  });

  describe("audit", () => {
    it("lists an organization's events newest first, pages with before, and names who acted", async () => {
      const { stores, ids, seed } = await build();
      const at = (minute: number) => new Date(Date.UTC(2026, 9, 19, 10, minute));

      await stores.audit.record({ action: "repository_config_updated", organizationId: ids.organizationId, userId: ids.userId, targetType: "repository", targetId: ids.repositoryId, ip: "203.0.113.7", userAgent: "Firefox", metadata: { changed: ["confidenceThreshold"] }, at: at(1) });
      await stores.audit.record({ action: "fixes_applied", organizationId: ids.organizationId, metadata: { githubLogin: "stranger" }, at: at(2) });
      await stores.audit.record({ action: "github_linked", organizationId: randomUUID(), userId: ids.userId, at: at(3) }).catch(() => undefined);

      const page = await stores.audit.listForOrganization(ids.organizationId, { limit: 10 });
      expect(page.map((e) => [e.action, e.actor])).toEqual([
        ["fixes_applied", "stranger"],
        ["repository_config_updated", seed.users[0]!.name ?? seed.users[0]!.githubLogin],
      ]);
      expect(page[1]).toMatchObject({ userId: ids.userId, targetType: "repository", targetId: ids.repositoryId, ip: "203.0.113.7", userAgent: "Firefox", metadata: { changed: ["confidenceThreshold"] }, createdAt: at(1).toISOString() });

      await expect(stores.audit.listForOrganization(ids.organizationId, { before: at(2), limit: 10 })).resolves.toMatchObject([{ action: "repository_config_updated" }]);
      await expect(stores.audit.listForOrganization(ids.organizationId, { limit: 1 })).resolves.toHaveLength(1);
    });
  });

  describe("users", () => {
    it("returns a user with their memberships and misses an unknown id", async () => {
      const { stores, ids, seed } = await build();

      await expect(stores.users.findById(ids.userId)).resolves.toEqual(seed.users[0]);
      await expect(stores.users.findById(randomUUID())).resolves.toBeUndefined();
    });

    it("omits the GitHub login of a user who has not linked GitHub", async () => {
      const { stores, ids } = await build(({ seed }) => {
        delete seed.users[0]!.githubLogin;
      });

      const user = await stores.users.findById(ids.userId);

      expect(user).toBeDefined();
      expect(user).not.toHaveProperty("githubLogin");
    });

    it("records a first sign-in as a new user without memberships", async () => {
      const { stores } = await build();
      const userId = randomUUID();

      await stores.users.recordSignIn({ userId, email: `new-${userId}@example.test`, name: "Ada Lovelace", avatarUrl: "https://a.example/ada.png" }, new Date());

      await expect(stores.users.findById(userId)).resolves.toEqual({
        userId,
        email: `new-${userId}@example.test`,
        name: "Ada Lovelace",
        avatarUrl: "https://a.example/ada.png",
        memberships: [],
      });
      await cleanUp?.({ userIds: [userId] });
    });

    it("refreshes an existing user's profile and keeps their memberships", async () => {
      const { stores, ids, seed } = await build();

      await stores.users.recordSignIn({ userId: ids.userId, name: "Renamed" }, new Date());

      const user = await stores.users.findById(ids.userId);
      expect(user).toMatchObject({ name: "Renamed", email: seed.users[0]!.email, memberships: seed.users[0]!.memberships });
    });

    it("skips an email another user already holds instead of failing", async () => {
      const { stores, seed } = await build();
      const userId = randomUUID();

      await stores.users.recordSignIn({ userId, email: seed.users[0]!.email!, name: "Duplicate" }, new Date());

      const user = await stores.users.findById(userId);
      expect(user).toMatchObject({ userId, name: "Duplicate" });
      expect(user).not.toHaveProperty("email");
      await cleanUp?.({ userIds: [userId] });
    });
  });

  describe.skipIf(!options.sessions)("sessions", () => {
    it("reports a signed-in session as active and an unknown one as not", async () => {
      const sessionId = randomUUID();
      const { stores } = await build(({ seed }) => {
        seed.activeSessionIds.push(sessionId);
      });

      await expect(stores.sessions.isActive(sessionId)).resolves.toBe(true);
      await expect(stores.sessions.isActive(randomUUID())).resolves.toBe(false);
    });

    it("lists a user's devices most recently active first, and signs one out only for its owner", async () => {
      const [laptop, phone, someoneElses] = [randomUUID(), randomUUID(), randomUUID()];
      const otherUser = randomUUID();
      const { stores, ids } = await build(({ seed, ids }) => {
        seed.activeSessionIds.push(laptop, phone, someoneElses);
        seed.sessions = [
          { sessionId: laptop, userId: ids.userId, createdAt: new Date("2026-10-01T09:00:00Z"), lastActiveAt: new Date("2026-10-19T08:00:00Z"), userAgent: "Firefox", ip: "203.0.113.7" },
          { sessionId: phone, userId: ids.userId, createdAt: new Date("2026-10-18T09:00:00Z"), lastActiveAt: new Date("2026-10-19T09:00:00Z") },
          { sessionId: someoneElses, userId: otherUser, createdAt: new Date("2026-10-18T09:00:00Z") },
        ];
      });

      const listed = await stores.sessions.listForUser(ids.userId);
      expect(listed.map((s) => s.sessionId)).toEqual([phone, laptop]);
      expect(listed[1]).toEqual({ sessionId: laptop, createdAt: new Date("2026-10-01T09:00:00Z"), lastActiveAt: new Date("2026-10-19T08:00:00Z"), userAgent: "Firefox", ip: "203.0.113.7" });

      await expect(stores.sessions.revoke(ids.userId, someoneElses)).resolves.toBe(false);
      await expect(stores.sessions.isActive(someoneElses)).resolves.toBe(true);
      await expect(stores.sessions.revoke(ids.userId, laptop)).resolves.toBe(true);
      await expect(stores.sessions.isActive(laptop)).resolves.toBe(false);
      await expect(stores.sessions.revoke(ids.userId, laptop)).resolves.toBe(false);
      await expect(stores.sessions.listForUser(ids.userId)).resolves.toMatchObject([{ sessionId: phone }]);
    });

    it("shows the device the gateway saw over Supabase's, and drops it once the session ends", async () => {
      const [laptop, phone] = [randomUUID(), randomUUID()];
      const { stores, ids } = await build(({ seed, ids }) => {
        seed.activeSessionIds.push(laptop, phone);
        seed.sessions = [
          // What Supabase records behind the dashboard: its own server.
          { sessionId: laptop, userId: ids.userId, createdAt: new Date("2026-10-01T09:00:00Z"), lastActiveAt: new Date("2026-10-19T08:00:00Z"), userAgent: "node", ip: "44.200.28.110" },
          { sessionId: phone, userId: ids.userId, createdAt: new Date("2026-10-18T09:00:00Z"), lastActiveAt: new Date("2026-10-19T09:00:00Z") },
        ];
      });

      await stores.sessions.touch({ sessionId: laptop, userId: ids.userId, ip: "110.226.114.105", userAgent: "Chrome" }, new Date("2026-10-20T10:00:00Z"));
      await stores.sessions.touch({ sessionId: laptop, userId: ids.userId, ip: "110.226.114.106", userAgent: "Chrome" }, new Date("2026-10-20T10:01:00Z"));
      const listed = await stores.sessions.listForUser(ids.userId);
      expect(listed[0]).toEqual({ sessionId: laptop, createdAt: new Date("2026-10-01T09:00:00Z"), lastActiveAt: new Date("2026-10-20T10:01:00Z"), userAgent: "Chrome", ip: "110.226.114.106" });
      expect(listed[1]).toMatchObject({ sessionId: phone, lastActiveAt: new Date("2026-10-19T09:00:00Z") });

      await stores.sessions.revoke(ids.userId, laptop);
      await stores.sessions.touch({ sessionId: laptop, userId: ids.userId, ip: "110.226.114.105" }, new Date("2026-10-20T10:02:00Z"));
      // A row left for a session that's no longer live is cleaned up on the next list.
      await expect(stores.sessions.listForUser(ids.userId)).resolves.toEqual([expect.objectContaining({ sessionId: phone })]);
    });
  });

  const repo = (githubRepoId: number, fullName: string) => ({ githubRepoId, fullName, defaultBranch: "main", isPrivate: true });
  const names = async (stores: Stores, organizationId: string) =>
    (await stores.repositories.listForOrganization(organizationId)).map((r) => r.fullName);

  describe("GitHub accounts and memberships", () => {
    it("links a GitHub account, re-links it to the same user, and refuses it for another user", async () => {
      const secondUserId = randomUUID();
      const { stores, ids } = await build(({ seed }) => {
        seed.users.push({ userId: secondUserId, memberships: [] });
      });
      const githubUserId = randomInt(1, 2 ** 47);

      await stores.users.linkGithub(ids.userId, { githubUserId, login: "octo-linked" });
      await stores.users.linkGithub(ids.userId, { githubUserId, login: "octo-renamed" });
      await expect(stores.users.findById(ids.userId)).resolves.toMatchObject({ githubUserId, githubLogin: "octo-renamed" });
      await expect(stores.users.findByGithubId(githubUserId)).resolves.toMatchObject({ userId: ids.userId, memberships: [{ organizationId: ids.organizationId }] });
      await expect(stores.users.findByGithubId(githubUserId + 1)).resolves.toBeUndefined();
      await expect(stores.users.linkGithub(secondUserId, { githubUserId, login: "octo-renamed" })).rejects.toThrow(GithubAccountTakenError);
    });

    it("applies a known role, and on an unknown one only inserts member without touching an existing role", async () => {
      const { stores, ids } = await build();
      const githubOrgId = randomInt(1, 2 ** 47);
      const created = await stores.installations.upsert({
        githubInstallationId: randomInt(1, 2 ** 47),
        account: { githubId: githubOrgId, login: `org-${githubOrgId}`, type: "organization" },
      });
      const roleIn = async (organizationId: string) =>
        (await stores.users.findById(ids.userId))?.memberships.find((m) => m.organizationId === organizationId)?.role;

      await stores.users.setMembership(created.organizationId, ids.userId, undefined);
      expect(await roleIn(created.organizationId)).toBe("member");
      await stores.users.setMembership(ids.organizationId, ids.userId, undefined);
      expect(await roleIn(ids.organizationId)).toBe("admin");
      await stores.users.setMembership(ids.organizationId, ids.userId, "member");
      expect(await roleIn(ids.organizationId)).toBe("member");
      await cleanUp?.({ githubOrgIds: [githubOrgId] });
    });
  });

  describe("installations", () => {
    it("upserts the account's organization and installation, idempotently", async () => {
      const { stores, ids } = await build();
      const account = { githubId: ids.githubOrgId, login: ids.orgLogin, type: "organization" as const };

      const first = await stores.installations.upsert({ githubInstallationId: ids.githubInstallationId, account });
      const again = await stores.installations.upsert({ githubInstallationId: ids.githubInstallationId, account });

      expect(first).toEqual({ organizationId: ids.organizationId, installationId: ids.installationId });
      expect(again).toEqual(first);
    });

    it("creates a new organization for a new account", async () => {
      const { stores, ids } = await build();
      const githubOrgId = randomInt(1, 2 ** 47);
      const created = await stores.installations.upsert({
        githubInstallationId: randomInt(1, 2 ** 47),
        account: { githubId: githubOrgId, login: `octo-${githubOrgId}`, type: "user" },
      });
      await stores.users.setMembership(created.organizationId, ids.userId, "admin");

      const listed = await stores.installations.listForUser(ids.userId);
      expect(listed.find((i) => i.organizationId === created.organizationId)).toMatchObject({
        accountLogin: `octo-${githubOrgId}`,
        accountType: "user",
        suspended: false,
        repositoryCount: 0,
      });
      expect(created.organizationId).not.toBe(ids.organizationId);
      await cleanUp?.({ githubOrgIds: [githubOrgId] });
    });

    it("syncs repositories: adds new ones, renames by GitHub id, and marks missing ones removed", async () => {
      const { stores, ids } = await build();
      const added = randomInt(1, 2 ** 47);
      const now = new Date();

      await stores.installations.syncRepositories(ids.githubInstallationId, [repo(ids.githubRepoId, `${ids.orgLogin}/renamed`), repo(added, `${ids.orgLogin}/new`)], now);
      expect(await names(stores, ids.organizationId)).toEqual([`${ids.orgLogin}/new`, `${ids.orgLogin}/renamed`]);

      await stores.installations.syncRepositories(ids.githubInstallationId, [repo(added, `${ids.orgLogin}/new`)], now);
      expect(await names(stores, ids.organizationId)).toEqual([`${ids.orgLogin}/new`]);
      await expect(stores.repositories.findByGithubRepoId(ids.githubRepoId)).resolves.toBeUndefined();
    });

    it("brings a removed repository back, with its id, when it is added again", async () => {
      const { stores, ids } = await build();
      const now = new Date();

      await stores.installations.removeRepositories(ids.githubInstallationId, [ids.githubRepoId], now);
      await expect(stores.repositories.findByGithubRepoId(ids.githubRepoId)).resolves.toBeUndefined();

      await stores.installations.addRepositories(ids.githubInstallationId, [repo(ids.githubRepoId, `${ids.orgLogin}/back`)], now);
      await expect(stores.repositories.findByGithubRepoId(ids.githubRepoId)).resolves.toMatchObject({
        repositoryId: ids.repositoryId,
        fullName: `${ids.orgLogin}/back`,
      });
    });

    it("lets a new repository take the name of a removed one", async () => {
      const { stores, ids, seed } = await build();
      const replacement = randomInt(1, 2 ** 47);
      const name = seed.repositories[0]!.fullName;

      await stores.installations.syncRepositories(ids.githubInstallationId, [repo(replacement, name)], new Date());

      await expect(stores.repositories.findByGithubRepoId(replacement)).resolves.toMatchObject({ fullName: name });
      await expect(stores.repositories.findByGithubRepoId(ids.githubRepoId)).resolves.toBeUndefined();
    });

    it("ignores a suspended installation's pull requests and resumes after unsuspend", async () => {
      const { stores, ids } = await build();

      await stores.installations.setSuspended(ids.githubInstallationId, new Date());
      await expect(stores.repositories.findByGithubRepoId(ids.githubRepoId)).resolves.toBeUndefined();
      expect(await names(stores, ids.organizationId)).toHaveLength(1);

      await stores.installations.setSuspended(ids.githubInstallationId, null);
      await expect(stores.repositories.findByGithubRepoId(ids.githubRepoId)).resolves.toBeDefined();
    });

    it("marks an uninstalled installation and its repositories removed, and a re-install restores the installation", async () => {
      const { stores, ids } = await build();

      await stores.installations.markUninstalled(ids.githubInstallationId, new Date());
      expect(await names(stores, ids.organizationId)).toEqual([]);
      expect(await stores.installations.listForUser(ids.userId)).toEqual([]);

      await stores.installations.upsert({
        githubInstallationId: ids.githubInstallationId,
        account: { githubId: ids.githubOrgId, login: ids.orgLogin, type: "organization" },
      });
      expect(await stores.installations.listForUser(ids.userId)).toHaveLength(1);
    });

    it("lists only the organization's own repositories", async () => {
      const mine = await build();
      const theirs = await build();

      expect(await names(mine.stores, mine.ids.organizationId)).toEqual([mine.seed.repositories[0]!.fullName]);
      expect(await names(mine.stores, theirs.ids.organizationId)).not.toContain(mine.seed.repositories[0]!.fullName);
    });
  });

  describe("githubTokens", () => {
    it("stores sealed tokens per user and replaces them on refresh", async () => {
      const { stores, ids } = await build();
      const expiresAt = new Date(Date.now() + 3_600_000);

      await expect(stores.githubTokens.get(ids.userId)).resolves.toBeUndefined();
      await stores.githubTokens.put(ids.userId, { accessTokenSealed: "v1.a", refreshTokenSealed: "v1.r", expiresAt });
      await stores.githubTokens.put(ids.userId, { accessTokenSealed: "v1.b", refreshTokenSealed: "v1.s", expiresAt });

      await expect(stores.githubTokens.get(ids.userId)).resolves.toEqual({ accessTokenSealed: "v1.b", refreshTokenSealed: "v1.s", expiresAt });
    });
  });
}
