import type { GitHubUserClient, GitHubUserTokens, UserInstallation } from "./github-user-client.js";

/** One GitHub user the stub knows: the code that signs them in, and what GitHub would say about them. */
export interface StubGitHubUser {
  code: string;
  id: number;
  login: string;
  installations: UserInstallation[];
  /** Role per organization login; missing means GitHub won't tell. */
  orgRoles?: Record<string, "admin" | "member">;
  /** GitHub repo ids the user can open, per installation id; missing means none. */
  repositoryIds?: Record<number, number[]>;
}

/**
 * In-memory `GitHubUserClient` for tests and local runs without OAuth credentials. Each code works
 * once, like GitHub's; tokens are `stub-access-<login>-<n>` and expire after `ttlMs`.
 */
export class StubGitHubUserClient implements GitHubUserClient {
  readonly users: StubGitHubUser[];
  readonly refreshed: string[] = [];
  private readonly ttlMs: number;
  private readonly now: () => Date;
  private readonly tokens = new Map<string, StubGitHubUser>();
  private readonly usedCodes = new Set<string>();
  private issued = 0;

  constructor(users: StubGitHubUser[] = [], { ttlMs = 8 * 3_600_000, now = () => new Date() } = {}) {
    this.users = users;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  async exchangeCode(code: string): Promise<GitHubUserTokens> {
    const user = this.users.find((candidate) => candidate.code === code);
    if (!user || this.usedCodes.has(code)) throw Object.assign(new Error("bad_verification_code"), { status: 401 });
    this.usedCodes.add(code);
    return this.issue(user);
  }

  async refresh(refreshToken: string): Promise<GitHubUserTokens> {
    const user = this.tokens.get(refreshToken);
    if (!user) throw Object.assign(new Error("bad_refresh_token"), { status: 401 });
    this.refreshed.push(refreshToken);
    return this.issue(user);
  }

  async getUser(accessToken: string) {
    const user = this.userFor(accessToken);
    return { id: user.id, login: user.login };
  }

  async listInstallations(accessToken: string) {
    return structuredClone(this.userFor(accessToken).installations);
  }

  async listInstallationRepositoryIds(accessToken: string, installationId: number) {
    return [...(this.userFor(accessToken).repositoryIds?.[installationId] ?? [])];
  }

  async getOrgRole(accessToken: string, org: string) {
    return this.userFor(accessToken).orgRoles?.[org];
  }

  private issue(user: StubGitHubUser): GitHubUserTokens {
    this.issued += 1;
    const accessToken = `stub-access-${user.login}-${this.issued}`;
    const refreshToken = `stub-refresh-${user.login}-${this.issued}`;
    this.tokens.set(accessToken, user);
    this.tokens.set(refreshToken, user);
    const now = this.now().getTime();
    return {
      accessToken,
      refreshToken,
      expiresAt: new Date(now + this.ttlMs),
      refreshExpiresAt: new Date(now + 180 * 86_400_000),
    };
  }

  private userFor(accessToken: string): StubGitHubUser {
    const user = this.tokens.get(accessToken);
    if (!user) throw Object.assign(new Error("Bad credentials"), { status: 401 });
    return user;
  }
}
