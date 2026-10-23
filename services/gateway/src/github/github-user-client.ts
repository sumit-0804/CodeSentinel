import { Octokit } from "@octokit/core";
import { exchangeWebFlowCode, refreshToken } from "@octokit/oauth-methods";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { request as defaultRequest } from "@octokit/request";

const GitHubOctokit = Octokit.plugin(paginateRest);

/** A GitHub App user-to-server token: 8 hours, renewed with a refresh token valid for 6 months. */
export interface GitHubUserTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  refreshExpiresAt?: Date;
}

export interface GitHubAccount {
  id: number;
  login: string;
  type: "user" | "organization";
}

/** An installation of our App that the signed-in GitHub user can see. */
export interface UserInstallation {
  id: number;
  account: GitHubAccount;
  suspendedAt?: Date;
}

/** GitHub calls made as the user (who they are, which installations they reach), not as the App. */
export interface GitHubUserClient {
  /** Exchanges the `code` GitHub sent back to the callback (OAuth web flow, also used during installation). */
  exchangeCode(code: string): Promise<GitHubUserTokens>;
  refresh(refreshToken: string): Promise<GitHubUserTokens>;
  getUser(accessToken: string): Promise<{ id: number; login: string }>;
  listInstallations(accessToken: string): Promise<UserInstallation[]>;
  /** GitHub ids of the installation's repositories this user can open (not every repository the App covers). */
  listInstallationRepositoryIds(accessToken: string, installationId: number): Promise<number[]>;
  /** The user's role in a GitHub organization, or undefined when GitHub won't say (not a member, no permission). */
  getOrgRole(accessToken: string, org: string): Promise<"admin" | "member" | undefined>;
}

export interface OctokitGitHubUserClientOptions {
  clientId: string;
  clientSecret: string;
  /** Defaults to the global `fetch`; injected in tests. */
  fetch?: typeof fetch;
}

interface GitHubInstallationItem {
  id: number | bigint;
  /** An enterprise account has a `slug` and no `login`; those installations are not supported. */
  account: { id: number | bigint; login?: string; type?: string } | null;
  suspended_at?: string | null;
}

const toTokens = (auth: { token: string; refreshToken?: string; expiresAt?: string; refreshTokenExpiresAt?: string }): GitHubUserTokens => ({
  accessToken: auth.token,
  ...(auth.refreshToken ? { refreshToken: auth.refreshToken } : {}),
  ...(auth.expiresAt ? { expiresAt: new Date(auth.expiresAt) } : {}),
  ...(auth.refreshTokenExpiresAt ? { refreshExpiresAt: new Date(auth.refreshTokenExpiresAt) } : {}),
});

export class OctokitGitHubUserClient implements GitHubUserClient {
  private readonly options: OctokitGitHubUserClientOptions;
  private readonly request: typeof defaultRequest;

  constructor(options: OctokitGitHubUserClientOptions) {
    this.options = options;
    this.request = options.fetch ? defaultRequest.defaults({ request: { fetch: options.fetch } }) : defaultRequest;
  }

  async exchangeCode(code: string): Promise<GitHubUserTokens> {
    const { authentication } = await exchangeWebFlowCode({
      clientType: "github-app",
      clientId: this.options.clientId,
      clientSecret: this.options.clientSecret,
      code,
      request: this.request,
    });
    return toTokens(authentication);
  }

  async refresh(token: string): Promise<GitHubUserTokens> {
    const { authentication } = await refreshToken({
      clientType: "github-app",
      clientId: this.options.clientId,
      clientSecret: this.options.clientSecret,
      refreshToken: token,
      request: this.request,
    });
    return toTokens(authentication);
  }

  async getUser(accessToken: string): Promise<{ id: number; login: string }> {
    const { data } = await this.as(accessToken).request("GET /user");
    return { id: Number(data.id), login: data.login };
  }

  async listInstallations(accessToken: string): Promise<UserInstallation[]> {
    const items: GitHubInstallationItem[] = await this.as(accessToken).paginate("GET /user/installations", { per_page: 100 });
    return items.flatMap((item) =>
      item.account?.login
        ? [
            {
              id: Number(item.id),
              account: {
                id: Number(item.account.id),
                login: item.account.login,
                type: item.account.type === "Organization" ? ("organization" as const) : ("user" as const),
              },
              ...(item.suspended_at ? { suspendedAt: new Date(item.suspended_at) } : {}),
            },
          ]
        : [],
    );
  }

  async listInstallationRepositoryIds(accessToken: string, installationId: number): Promise<number[]> {
    const repos: { id: number | bigint }[] = await this.as(accessToken).paginate("GET /user/installations/{installation_id}/repositories", {
      installation_id: installationId,
      per_page: 100,
    });
    return repos.map((repo) => Number(repo.id));
  }

  async getOrgRole(accessToken: string, org: string): Promise<"admin" | "member" | undefined> {
    try {
      const { data } = await this.as(accessToken).request("GET /user/memberships/orgs/{org}", { org });
      if (data.state !== "active") return undefined;
      return data.role === "admin" ? "admin" : "member";
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 403 || status === 404) return undefined;
      throw error;
    }
  }

  private as(accessToken: string) {
    return new GitHubOctokit({
      auth: accessToken,
      ...(this.options.fetch ? { request: { fetch: this.options.fetch } } : {}),
    });
  }
}
