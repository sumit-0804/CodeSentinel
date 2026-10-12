import { ReviewDefaultsUpdateSchema, type ReviewDefaults } from "@code-sentinel/contracts";
import { badRequest, notFound } from "@code-sentinel/service-kit";
import { Router, type Request } from "express";

import { assertOrgAdmin, assertStepUp, requireUserSession, type StepUpPolicy } from "../auth/guards.js";
import type { GatewayResponse } from "../auth/principal.js";
import { applyReviewDefaultsUpdate, resolveAgentSettings, toReviewDefaults } from "../persistence/effective-config.js";
import type { RepositoryConfigStore, UserStore } from "../persistence/stores.js";

export interface OrganizationsRouterDeps {
  repositoryConfig: RepositoryConfigStore;
  users: Pick<UserStore, "findById">;
  stepUp: StepUpPolicy;
}

/** `GET` / `PUT /v1/organizations/{id}/review-defaults` (A9): what repositories following the defaults use. */
export function createOrganizationsRouter({ repositoryConfig, users, stepUp }: OrganizationsRouterDeps): Router {
  const router = Router();

  // A signed-in user reads any organization they belong to; an API key only its own. Others answer 404.
  const loadDefaults = async (req: Request<{ organizationId: string }>, res: GatewayResponse) => {
    const { organizationId } = req.params;
    const principal = res.locals.principal!;
    const member =
      principal.method === "api_key"
        ? principal.organizationId === organizationId
        : (await users.findById(principal.userId))?.memberships.some((m) => m.organizationId === organizationId) === true;
    const defaults = member ? await repositoryConfig.getReviewDefaults(organizationId) : undefined;
    if (!defaults) throw notFound("organization_not_found", "No such organization");
    return defaults;
  };

  router.get("/organizations/:organizationId/review-defaults", async (req: Request<{ organizationId: string }>, res: GatewayResponse) => {
    const body: ReviewDefaults = toReviewDefaults(req.params.organizationId, await loadDefaults(req, res));
    res.json(body);
  });

  router.put(
    "/organizations/:organizationId/review-defaults",
    requireUserSession,
    async (req: Request<{ organizationId: string }>, res: GatewayResponse) => {
      const parsed = ReviewDefaultsUpdateSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("invalid_body", "The review defaults are not valid", { issues: parsed.error.issues });
      const { organizationId } = req.params;
      const defaults = await loadDefaults(req, res);
      const { userId } = res.locals.principal!;
      await assertOrgAdmin(users, userId, organizationId);
      assertStepUp(res.locals.principal!, stepUp);

      const next = applyReviewDefaultsUpdate(defaults, parsed.data);
      if (resolveAgentSettings({ useOrgDefaults: true, repositoryModes: {}, organization: next }).every(({ mode }) => mode === "off")) {
        throw badRequest("no_agents_enabled", "At least one agent must stay on");
      }
      await repositoryConfig.updateReviewDefaults(organizationId, parsed.data, userId);
      const body: ReviewDefaults = toReviewDefaults(organizationId, (await repositoryConfig.getReviewDefaults(organizationId))!);
      res.json(body);
    },
  );

  return router;
}
