import type { AuditEvent } from "@code-sentinel/contracts";

import type { AuditEventInput, UserRecord } from "./stores.js";

/** The audit log's row as the API shows it, with a display name for who acted. */
export function toAuditEvent(
  event: AuditEventInput & { eventId: string },
  user: Pick<UserRecord, "name" | "githubLogin" | "email"> | undefined,
): AuditEvent {
  const githubLogin = typeof event.metadata?.githubLogin === "string" ? event.metadata.githubLogin : undefined;
  const actor = user?.name ?? user?.githubLogin ?? user?.email ?? githubLogin;
  return {
    eventId: event.eventId,
    action: event.action,
    ...(event.userId ? { userId: event.userId } : {}),
    ...(actor ? { actor } : {}),
    ...(event.targetType ? { targetType: event.targetType } : {}),
    ...(event.targetId ? { targetId: event.targetId } : {}),
    ...(event.ip ? { ip: event.ip } : {}),
    ...(event.userAgent ? { userAgent: event.userAgent } : {}),
    ...(event.metadata ? { metadata: event.metadata } : {}),
    createdAt: event.at.toISOString(),
  };
}
