import type { ServiceHandler, ServiceLocals, ServiceResponse } from "@code-sentinel/service-kit";

/** Who is calling, resolved by the auth middleware (FR-GW-02). Every org-owned read is scoped to `organizationId` (NFR-13). */
export interface Principal {
  userId: string;
  /** The `X-Organization-Id` header, or the user's only membership. */
  organizationId?: string;
  /** The Supabase session id and assurance level, for step-up checks (A7). */
  sessionId: string;
  aal: string;
  amr: { method: string; timestamp: number }[];
  /** Every sign-in method linked to the account (`email`, `github`, `google`). */
  providers: string[];
}

/** What the gateway's middleware stores on `res.locals`: the kit's fields plus the caller. */
export interface GatewayLocals extends ServiceLocals {
  /** Set by the auth middleware on `/v1` routes. */
  principal?: Principal;
}

export type GatewayResponse = ServiceResponse<GatewayLocals>;
export type GatewayHandler = ServiceHandler<GatewayLocals>;
