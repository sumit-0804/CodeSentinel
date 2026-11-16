import { beforeEach, describe, expect, it, vi } from "vitest";

const gatewayFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/gateway", () => ({ gatewayFetch }));
vi.mock("@/lib/organization", () => ({ getAccount: async () => ({ ok: true, current: { organizationId: "org-1" } }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { applyAllFixes, commitFix, dismissFix } from "@/app/(app)/pull-requests/actions";

const ID = "4f97c30e-a9f8-406f-a450-0bd7803cb4f4";
const timeoutOf = (call: number) => (gatewayFetch.mock.calls[call]![2] as { timeoutMs?: number }).timeoutMs;

describe("fix actions", () => {
  beforeEach(() => {
    gatewayFetch.mockReset();
    gatewayFetch.mockResolvedValue({ ok: true, data: { commitSha: "abc", applied: 1, aiApplied: 1, skipped: 0 } });
  });

  // The default 5 seconds ran out while the gateway was still committing on GitHub.
  it("gives the gateway well over the default 5 seconds to commit", async () => {
    await commitFix(ID);
    await applyAllFixes(ID);
    expect(timeoutOf(0)).toBeGreaterThanOrEqual(30_000);
    expect(timeoutOf(1)).toBeGreaterThanOrEqual(30_000);
  });

  it("keeps the default timeout for a dismissal, which writes no code", async () => {
    await dismissFix(ID, "false_positive", "");
    expect(gatewayFetch).toHaveBeenCalledOnce();
    expect(timeoutOf(0)).toBeUndefined();
  });
});
