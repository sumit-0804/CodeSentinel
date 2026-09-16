import type { ServiceHandler, ServiceLocals, ServiceResponse } from "@code-sentinel/service-kit";

/** Who is calling, resolved by the auth middleware (FR-GW-02). Every read is scoped to `organizationId` (NFR-13). */
export interface Principal {
  userId: string;
  organizationId: string;
  method: "session" | "api_key";
}

/** What the gateway's middleware stores on `res.locals`: the kit's fields plus the caller. */
export interface GatewayLocals extends ServiceLocals {
  /** Set by the auth middleware on `/v1` routes. */
  principal?: Principal;
}

export type GatewayResponse = ServiceResponse<GatewayLocals>;
export type GatewayHandler = ServiceHandler<GatewayLocals>;
