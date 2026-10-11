import type { RepositoryListResponse } from "@code-sentinel/contracts";
import { Router, type Request } from "express";

import { requireOrganization } from "../auth/guards.js";
import type { GatewayResponse } from "../auth/principal.js";
import type { RepositoryStore } from "../persistence/stores.js";

/** `GET /v1/repositories`: the caller's organization's active repositories (NFR-13). Toggles and config are A9. */
export function createRepositoriesRouter({ repositories }: { repositories: RepositoryStore }): Router {
  const router = Router();

  router.get("/repositories", requireOrganization, async (req: Request, res: GatewayResponse) => {
    const all = await repositories.listForOrganization(res.locals.principal!.organizationId!);
    // `?enabledOnly=true` (gateway.yaml) keeps only repositories with reviews switched on.
    const items = req.query.enabledOnly === "true" ? all.filter((repo) => repo.reviewEnabled) : all;
    const body: RepositoryListResponse = { items };
    res.json(body);
  });

  return router;
}
