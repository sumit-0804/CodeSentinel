import type { CurrentUser } from "@code-sentinel/contracts";
import { Router, type Request } from "express";

import type { GatewayResponse } from "../auth/principal.js";
import { unauthorized } from "../http/errors.js";
import type { UserStore } from "../persistence/stores.js";

export interface MeRouterDeps {
  users: UserStore;
}

/** `GET /v1/me`: the caller's identity and organization memberships. Mounted behind the auth middleware. */
export function createMeRouter({ users }: MeRouterDeps): Router {
  const router = Router();

  router.get("/me", async (_req: Request, res: GatewayResponse) => {
    const { principal } = res.locals;
    if (!principal) throw unauthorized("unauthenticated", "Sign in or send an API key as a bearer token");

    // A credential whose user has since been deleted is no longer valid.
    const user = await users.findById(principal.userId);
    if (!user) throw unauthorized("invalid_credentials", "The supplied credentials are not valid");

    const body: CurrentUser = {
      userId: user.userId,
      githubLogin: user.githubLogin,
      ...(user.email !== undefined ? { email: user.email } : {}),
      ...(user.avatarUrl !== undefined ? { avatarUrl: user.avatarUrl } : {}),
      organizations: user.memberships,
    };
    res.json(body);
  });

  return router;
}
