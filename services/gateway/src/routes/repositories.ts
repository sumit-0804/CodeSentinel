import { RepositoryConfigUpdateSchema, type RepositoryConfig, type RepositoryListResponse } from "@code-sentinel/contracts";
import { badRequest, notFound } from "@code-sentinel/service-kit";
import { Router, type Request } from "express";

import type { AuditLog } from "../audit/audit-log.js";
import { assertOrgAdmin, assertStepUp, requireOrganization, type StepUpPolicy } from "../auth/guards.js";
import type { GatewayResponse } from "../auth/principal.js";
import { applyRepositoryConfigUpdate, resolveEffectiveConfig, toRepositoryConfig } from "../persistence/effective-config.js";
import type { RepositoryConfigStore, RepositoryStore, UserStore } from "../persistence/stores.js";

export interface RepositoriesRouterDeps {
  repositories: RepositoryStore;
  repositoryConfig: RepositoryConfigStore;
  users: Pick<UserStore, "findById">;
  stepUp: StepUpPolicy;
  audit: Pick<AuditLog, "request">;
}

/** `GET /v1/repositories` and each repository's configuration (UC-4, A9), scoped to the caller's organization (NFR-13). */
export function createRepositoriesRouter({ repositories, repositoryConfig, users, stepUp, audit }: RepositoriesRouterDeps): Router {
  const router = Router();

  router.get("/repositories", requireOrganization, async (req: Request, res: GatewayResponse) => {
    const all = await repositories.listForOrganization(res.locals.principal!.organizationId!);
    // `?enabledOnly=true` (gateway.yaml) keeps only repositories with reviews switched on.
    const items = req.query.enabledOnly === "true" ? all.filter((repo) => repo.reviewEnabled) : all;
    const body: RepositoryListResponse = { items };
    res.json(body);
  });

  // Another organization's repository answers 404, like an unknown one, so ids can't be probed.
  const loadOwn = async (req: Request<{ repositoryId: string }>, res: GatewayResponse) => {
    const inputs = await repositoryConfig.getConfigInputs(req.params.repositoryId);
    if (!inputs || inputs.organizationId !== res.locals.principal!.organizationId) {
      throw notFound("repository_not_found", "No such repository in this organization");
    }
    return inputs;
  };

  router.get("/repositories/:repositoryId/config", requireOrganization, async (req: Request<{ repositoryId: string }>, res: GatewayResponse) => {
    const body: RepositoryConfig = toRepositoryConfig(await loadOwn(req, res));
    res.json(body);
  });

  router.put(
    "/repositories/:repositoryId/config",
    requireOrganization,
    async (req: Request<{ repositoryId: string }>, res: GatewayResponse) => {
      const parsed = RepositoryConfigUpdateSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("invalid_body", "The configuration is not valid", { issues: parsed.error.issues });
      const inputs = await loadOwn(req, res);
      const { userId } = res.locals.principal!;
      await assertOrgAdmin(users, userId, inputs.organizationId);
      assertStepUp(res.locals.principal!, stepUp);

      if (resolveEffectiveConfig(applyRepositoryConfigUpdate(inputs, parsed.data)).enabledAgents.length === 0) {
        throw badRequest("no_agents_enabled", "At least one agent must stay on; switch reviews off instead");
      }
      await repositoryConfig.updateConfig(inputs.repositoryId, parsed.data, userId);
      const changed = Object.keys(parsed.data);
      await audit.request(req, res, {
        action: changed.length === 1 && changed[0] === "reviewEnabled" ? "repository_reviews_toggled" : "repository_config_updated",
        targetType: "repository",
        targetId: inputs.repositoryId,
        metadata: { changed, ...(parsed.data.reviewEnabled !== undefined ? { reviewEnabled: parsed.data.reviewEnabled } : {}) },
      });
      const body: RepositoryConfig = toRepositoryConfig((await repositoryConfig.getConfigInputs(inputs.repositoryId))!);
      res.json(body);
    },
  );

  return router;
}
