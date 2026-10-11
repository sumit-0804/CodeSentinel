"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getAccount } from "@/lib/organization";
import { ORG_COOKIE } from "@/lib/organization-choice";

/** Switches the organization the dashboard works in; only one the gateway says the user belongs to. */
export async function chooseOrganization(organizationId: string): Promise<{ ok: boolean }> {
  const account = await getAccount();
  if (!account.ok || !account.organizations.some((org) => org.organizationId === organizationId)) return { ok: false };

  (await cookies()).set(ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 86_400,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
