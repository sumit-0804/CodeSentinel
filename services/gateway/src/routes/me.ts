import type { CurrentUser, SessionList } from "@code-sentinel/contracts";
import { HttpError, notFound, unauthorized } from "@code-sentinel/service-kit";
import { Router, type Request } from "express";
import { z } from "zod";

import type { AuditLog } from "../audit/audit-log.js";
import { assertStepUp, type StepUpPolicy } from "../auth/guards.js";
import type { GatewayResponse } from "../auth/principal.js";
import type { SessionStore, UserStore } from "../persistence/stores.js";

export interface MeRouterDeps {
  users: UserStore;
  sessions: Pick<SessionStore, "listForUser" | "revoke">;
  stepUp: StepUpPolicy;
  audit: Pick<AuditLog, "request">;
}

const SessionIdSchema = z.string().uuid();

/**
 * `GET /v1/me`: the caller's identity and organization memberships; `/v1/me/sessions`: their signed-in
 * devices, and signing one out (WP6). Mounted behind the auth middleware.
 */
export function createMeRouter({ users, sessions, stepUp, audit }: MeRouterDeps): Router {
  const router = Router();

  router.get("/me", async (_req: Request, res: GatewayResponse) => {
    const { principal } = res.locals;
    if (!principal) throw unauthorized("unauthenticated", "Sign in and send your access token as a bearer token");

    // A credential whose user has since been deleted is no longer valid.
    const user = await users.findById(principal.userId);
    if (!user) throw unauthorized("invalid_credentials", "The supplied credentials are not valid");

    const body: CurrentUser = {
      userId: user.userId,
      ...(user.githubLogin !== undefined ? { githubLogin: user.githubLogin } : {}),
      ...(user.email !== undefined ? { email: user.email } : {}),
      ...(user.name !== undefined ? { name: user.name } : {}),
      ...(user.avatarUrl !== undefined ? { avatarUrl: user.avatarUrl } : {}),
      providers: principal.providers,
      organizations: user.memberships.map(({ organizationId, displayName, role }) => ({ organizationId, displayName, role })),
    };
    res.json(body);
  });

  router.get("/me/sessions", async (_req: Request, res: GatewayResponse) => {
    const { userId, sessionId } = res.locals.principal!;
    const body: SessionList = {
      items: (await sessions.listForUser(userId)).map((session) => ({
        sessionId: session.sessionId,
        createdAt: session.createdAt.toISOString(),
        ...(session.lastActiveAt ? { lastActiveAt: session.lastActiveAt.toISOString() } : {}),
        ...(session.userAgent ? { userAgent: session.userAgent } : {}),
        ...(session.ip ? { ip: session.ip } : {}),
        current: session.sessionId === sessionId,
      })),
    };
    res.json(body);
  });

  router.delete("/me/sessions/:sessionId", async (req: Request<{ sessionId: string }>, res: GatewayResponse) => {
    const principal = res.locals.principal!;
    const id = SessionIdSchema.safeParse(req.params.sessionId);
    if (!id.success) throw notFound("session_not_found", "No such session of yours");
    if (id.data === principal.sessionId) throw new HttpError(409, "current_session", "This is the device you are using; sign out instead");
    assertStepUp(principal, stepUp);

    // Another user's session answers 404, like an unknown one.
    if (!(await sessions.revoke(principal.userId, id.data))) throw notFound("session_not_found", "No such session of yours");
    await audit.request(req, res, { action: "session_revoked", targetType: "session", targetId: id.data });
    res.status(204).end();
  });

  return router;
}
