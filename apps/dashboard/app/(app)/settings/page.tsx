import { Suspense } from "react";
import type { Metadata } from "next";
import { PageHead } from "@/components/app/page-parts";
import { CurrentUserSchema } from "@code-sentinel/contracts";
import { AccountSettings, type OrganizationsState, type SignInMethod } from "@/components/settings/account-settings";
import { requireUser } from "@/lib/auth";
import { gatewayFetch } from "@/lib/gateway";
import { toShellUser } from "@/lib/shell-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  { label: "Account", current: true },
  { label: "Review defaults", note: "soon" },
  { label: "Two-factor", note: "soon" },
  { label: "API keys", note: "later" },
];

async function AccountContent() {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  const [{ data }, me] = await Promise.all([supabase.auth.getUserIdentities(), gatewayFetch("/v1/me", CurrentUserSchema)]);
  const identities = data?.identities ?? [];
  const organizations: OrganizationsState = me.ok
    ? { status: "ok", list: me.data.organizations }
    : { status: "unavailable", reason: me.reason };

  const detail = (provider: string) => {
    const identity = identities.find((item) => item.provider === provider);
    if (!identity) return null;
    const meta = identity.identity_data ?? {};
    const handle = meta.user_name ?? meta.preferred_username ?? meta.email ?? user.email;
    return typeof handle === "string" ? handle : "Connected";
  };

  const methods: SignInMethod[] = [
    { provider: "email", label: "Email and password", detail: detail("email") },
    { provider: "github", label: "GitHub", detail: detail("github") },
    { provider: "google", label: "Google", detail: detail("google") },
  ];
  return <AccountSettings user={toShellUser(user)} methods={methods} organizations={organizations} />;
}

export default function SettingsPage() {
  return (
    <>
      <PageHead title="Settings" />
      <div className="grid items-start gap-[18px] min-[1041px]:grid-cols-[210px_minmax(0,1fr)] min-[1041px]:gap-10">
        <nav aria-label="Settings sections" className="flex gap-[3px] overflow-x-auto min-[1041px]:sticky min-[1041px]:top-[74px] min-[1041px]:grid">
          {SECTIONS.map(({ label, current, note }) => (
            <span
              key={label}
              aria-current={current ? "page" : undefined}
              aria-disabled={current ? undefined : true}
              className={
                current
                  ? "flex h-[38px] items-center rounded-[10px] border border-line-2 bg-panel-2 px-3 text-[14.5px] font-semibold whitespace-nowrap text-ink"
                  : "flex h-[38px] cursor-not-allowed items-center justify-between gap-2 rounded-[10px] px-3 text-[14.5px] font-semibold whitespace-nowrap text-ink-3"
              }
            >
              {label}
              {note ? <small className="text-[11.5px]">{note}</small> : null}
            </span>
          ))}
        </nav>
        <Suspense fallback={<div className="h-[420px] animate-pulse rounded-2xl bg-panel" />}>
          <AccountContent />
        </Suspense>
      </div>
    </>
  );
}
