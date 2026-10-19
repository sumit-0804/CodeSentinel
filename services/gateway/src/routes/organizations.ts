import { ReviewDefaultsUpdateSchema, type AuditEventList, type ReviewDefaults } from "@code-sentinel/contracts";
import { badRequest, notFound } from "@code-sentinel/service-kit";
import { Router, type Request } from "express";
import { z } from "zod";

import type { AuditLog } from "../audit/audit-log.js";
import { assertOrgAdmin, assertStepUp, type StepUpPolicy } from "../auth/guards.js";
import type { GatewayResponse } from "../auth/principal.js";
import { applyReviewDefaultsUpdate, resolveAgentSettings, toReviewDefaults } from "../persistence/effective-config.js";
import type { AuditStore, RepositoryConfigStore, UserStore } from "../persistence/stores.js";

export interface OrganizationsRouterDeps {
  repositoryConfig: RepositoryConfigStore;
  users: Pick<UserStore, "findById">;
  stepUp: StepUpPolicy;
  audit: Pick<AuditLog, "request">;
  auditEvents: Pick<AuditStore, "listForOrganization">;
}

const AuditQuerySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * `GET` / `PUT /v1/organizations/{id}/review-defaults` (A9): what repositories following the defaults use;
 * `GET /v1/organizations/{id}/audit-events` (WP6): the admins' audit log.
 */
export function createOrganizationsRouter({ repositoryConfig, users, stepUp, audit, auditEvents }: OrganizationsRouterDeps): Router {
  const router = Router();

  // A signed-in user reads any organization they belong to. Others answer 404.
  const assertMember = async (organizationId: string, res: GatewayResponse) => {
    const user = await users.findById(res.locals.principal!.userId);
    if (!user?.memberships.some((m) => m.organizationId === organizationId)) throw notFound("organization_not_found", "No such organization");
  };

  const loadDefaults = async (req: Request<{ organizationId: string }>, res: GatewayResponse) => {
    await assertMember(req.params.organizationId, res);
    const defaults = await repositoryConfig.getReviewDefaults(req.params.organizationId);
    if (!defaults) throw notFound("organization_not_found", "No such organization");
    return defaults;
  };

  router.get("/organizations/:organizationId/review-defaults", async (req: Request<{ organizationId: string }>, res: GatewayResponse) => {
    const body: ReviewDefaults = toReviewDefaults(req.params.organizationId, await loadDefaults(req, res));
    res.json(body);
  });

  router.put(
    "/organizations/:organizationId/review-defaults",
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
      await audit.request(req, res, {
        action: "review_defaults_updated",
        organizationId,
        targetType: "organization",
        targetId: organizationId,
        metadata: { changed: Object.keys(parsed.data) },
      });
      const body: ReviewDefaults = toReviewDefaults(organizationId, (await repositoryConfig.getReviewDefaults(organizationId))!);
      res.json(body);
    },
  );

  router.get("/organizations/:organizationId/audit-events", async (req: Request<{ organizationId: string }>, res: GatewayResponse) => {
    const query = AuditQuerySchema.safeParse(req.query);
    if (!query.success) throw badRequest("invalid_query", "before must be a date-time and limit 1..100", { issues: query.error.issues });
    const { organizationId } = req.params;
    await assertMember(organizationId, res);
    await assertOrgAdmin(users, res.locals.principal!.userId, organizationId);

    const { limit, before } = query.data;
    // One extra row says whether another page exists.
    const rows = await auditEvents.listForOrganization(organizationId, { limit: limit + 1, ...(before ? { before: new Date(before) } : {}) });
    const items = rows.slice(0, limit);
    const body: AuditEventList = { items, ...(rows.length > limit ? { nextBefore: items.at(-1)!.createdAt } : {}) };
    res.json(body);
  });

  return router;
}
