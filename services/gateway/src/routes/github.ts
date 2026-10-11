import {
  GithubLinkRequestSchema,
  type GithubLinkResult,
  type InstallationListResponse,
} from "@code-sentinel/contracts";
import { badGateway, badRequest, HttpError, type Logger } from "@code-sentinel/service-kit";
import { Router, type Request } from "express";

import { requireUserSession } from "../auth/guards.js";
import type { GatewayResponse } from "../auth/principal.js";
import type { GitHubUserClient, GitHubUserTokens } from "../github/github-user-client.js";
import { GithubNotLinkedError, type InstallationSync, type SyncedInstallation } from "../github/installation-sync.js";
import { GithubAccountTakenError, type InstallationStore, type UserStore } from "../persistence/stores.js";

export interface GithubRouterDeps {
  users: UserStore;
  installations: InstallationStore;
  /** Absent when the App's OAuth credentials or `FIELD_ENCRYPTION_KEY` are not configured. */
  link?: { githubUsers: GitHubUserClient; sync: InstallationSync };
  logger: Pick<Logger, "warn">;
}

const unconfigured = () =>
  new HttpError(503, "github_link_unconfigured", "Connecting GitHub is not configured on this server");
const notLinked = () => new HttpError(409, "github_not_linked", "Connect GitHub first, then sync again");

const summary = (items: SyncedInstallation[]) =>
  items.map(({ organizationId, accountLogin, accountType, repositoryCount }) => ({ organizationId, accountLogin, accountType, repositoryCount }));

/**
 * GitHub onboarding (A6): link the signed-in user's GitHub account from the App's callback `code`, sync
 * the installations they reach, and list them. Account routes: API keys are refused (`requireUserSession`).
 * A7 adds a TOTP step-up to `link` and `sync`, which change what Code Sentinel can access.
 */
export function createGithubRouter({ users, installations, link, logger }: GithubRouterDeps): Router {
  const router = Router();

  router.post("/github/link", requireUserSession, async (req: Request, res: GatewayResponse) => {
    if (!link) throw unconfigured();
    const parsed = GithubLinkRequestSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("invalid_body", "Send { code } from GitHub's redirect");
    const userId = res.locals.principal!.userId;

    let tokens: GitHubUserTokens;
    try {
      tokens = await link.githubUsers.exchangeCode(parsed.data.code);
    } catch (error) {
      // GitHub rejects reused, expired or foreign codes; the reason is logged, not returned.
      logger.warn("github code exchange failed", { reason: error instanceof Error ? error.message : String(error) });
      throw badRequest("github_code_invalid", "That GitHub authorization expired or was already used; start again");
    }

    let githubUser: { id: number; login: string };
    try {
      githubUser = await link.githubUsers.getUser(tokens.accessToken);
    } catch {
      throw badGateway("github_unavailable", "GitHub did not answer; try again in a moment");
    }

    try {
      await users.linkGithub(userId, { githubUserId: githubUser.id, login: githubUser.login });
    } catch (error) {
      if (error instanceof GithubAccountTakenError) {
        throw new HttpError(409, "github_account_taken", "This GitHub account is linked to another Code Sentinel user");
      }
      throw error;
    }
    await link.sync.storeTokens(userId, tokens);

    const synced = await syncOrFail(link.sync, userId);
    const body: GithubLinkResult = { githubLogin: githubUser.login, installations: summary(synced) };
    res.json(body);
  });

  router.post("/installations/sync", requireUserSession, async (_req: Request, res: GatewayResponse) => {
    if (!link) throw unconfigured();
    const userId = res.locals.principal!.userId;
    const githubLogin = (await users.findById(userId))?.githubLogin;
    if (!githubLogin) throw notLinked();

    const synced = await syncOrFail(link.sync, userId);
    const body: GithubLinkResult = { githubLogin, installations: summary(synced) };
    res.json(body);
  });

  router.get("/installations", requireUserSession, async (_req: Request, res: GatewayResponse) => {
    const items = await installations.listForUser(res.locals.principal!.userId);
    const body: InstallationListResponse = {
      items: items.map(({ organizationId, accountLogin, accountType, suspended, repositoryCount }) => ({
        organizationId,
        accountLogin,
        accountType,
        suspended,
        repositoryCount,
      })),
    };
    res.json(body);
  });

  return router;
}

async function syncOrFail(sync: InstallationSync, userId: string): Promise<SyncedInstallation[]> {
  try {
    return await sync.syncForUser(userId);
  } catch (error) {
    if (error instanceof GithubNotLinkedError) throw notLinked();
    if (error instanceof HttpError) throw error;
    // A GitHub outage or revoked token surfaces here; the stores are untouched or idempotently half-done.
    throw badGateway("github_unavailable", "GitHub did not answer; try again in a moment");
  }
}
