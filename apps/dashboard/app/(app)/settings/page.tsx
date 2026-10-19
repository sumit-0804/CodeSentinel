import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHead } from "@/components/app/page-parts";
import { AuditEventListSchema, CurrentUserSchema, SessionListSchema } from "@code-sentinel/contracts";
import { ReviewDefaultsSettings } from "@/components/config/review-defaults-settings";
import { AuditLog } from "@/components/settings/audit-log";
import { AccountSettings, type OrganizationsState, type SignInMethod } from "@/components/settings/account-settings";
import { SecuritySettings } from "@/components/settings/security-settings";
import { SignedInDevices } from "@/components/settings/signed-in-devices";
import { requireUser } from "@/lib/auth";
import { gatewayFetch } from "@/lib/gateway";
import { listAuthenticators } from "@/lib/mfa";
import { getAccount } from "@/lib/organization";
import { getDefaultsPageData } from "@/lib/repository-config";
import { toShellUser } from "@/lib/shell-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

type Section = "account" | "defaults" | "security" | "audit";

const SECTIONS: { label: string; section: Section }[] = [
  { label: "Account", section: "account" },
  { label: "Review defaults", section: "defaults" },
  { label: "Security", section: "security" },
  { label: "Audit log", section: "audit" },
];

async function SecurityContent() {
  await requireUser();
  const [authenticators, sessions] = await Promise.all([listAuthenticators(), gatewayFetch("/v1/me/sessions", SessionListSchema)]);
  return (
    <div className="grid min-w-0 gap-[30px]">
      <SecuritySettings authenticators={authenticators} />
      <SignedInDevices sessions={sessions.ok ? sessions.data.items : null} />
    </div>
  );
}

const UNAVAILABLE = {
  unconfigured: "The API isn't configured for this dashboard (GATEWAY_URL).",
  unreachable: "Couldn't reach the API. Try again in a moment.",
  unauthorized: "The API didn't accept your session. Sign out and in again.",
  error: "The API answered with an error. Try again in a moment.",
  no_organization: "Connect GitHub first: review defaults belong to an organization.",
} as const;

async function DefaultsContent() {
  const data = await getDefaultsPageData();
  if (!data.ok) return <EmptyState title="Review defaults aren't available">{UNAVAILABLE[data.reason]}</EmptyState>;
  return <ReviewDefaultsSettings defaults={data.defaults} organizationName={data.organizationName} isAdmin={data.isAdmin} />;
}

async function AuditContent({ before }: { before: string | undefined }) {
  const account = await getAccount();
  if (!account.ok) return <EmptyState title="The audit log isn't available">{UNAVAILABLE[account.reason]}</EmptyState>;
  const organization = account.current;
  if (!organization) return <EmptyState title="The audit log isn't available">{UNAVAILABLE.no_organization}</EmptyState>;
  if (organization.role !== "admin") {
    return <EmptyState title="Only admins see the audit log">Ask an admin of {organization.displayName} if you need to know who changed something.</EmptyState>;
  }
  const query = new URLSearchParams({ limit: "50", ...(before && !Number.isNaN(Date.parse(before)) ? { before } : {}) });
  const page = await gatewayFetch(`/v1/organizations/${organization.organizationId}/audit-events?${query}`, AuditEventListSchema, {
    organizationId: organization.organizationId,
  });
  if (!page.ok) return <EmptyState title="The audit log isn't available">{UNAVAILABLE[page.reason]}</EmptyState>;
  return <AuditLog organizationName={organization.displayName} events={page.data.items} {...(page.data.nextBefore ? { nextBefore: page.data.nextBefore } : {})} />;
}

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

const ITEM = "flex h-[38px] items-center justify-between gap-2 rounded-[10px] px-3 text-[14.5px] font-semibold whitespace-nowrap";

async function SettingsBody({ searchParams }: { searchParams: PageProps<"/settings">["searchParams"] }) {
  const { section, before } = await searchParams;
  const current: Section = section === "defaults" || section === "security" || section === "audit" ? section : "account";
  return (
    <div className="grid items-start gap-[18px] min-[1041px]:grid-cols-[210px_minmax(0,1fr)] min-[1041px]:gap-10">
      <nav aria-label="Settings sections" className="flex gap-[3px] overflow-x-auto min-[1041px]:sticky min-[1041px]:top-[74px] min-[1041px]:grid">
        {SECTIONS.map(({ label, section: target }) => (
          <Link
            key={label}
            href={target === "account" ? "/settings" : `/settings?section=${target}`}
            aria-current={target === current ? "page" : undefined}
            className={
              target === current
                ? `${ITEM} border border-line-2 bg-panel-2 text-ink`
                : `${ITEM} border border-transparent text-ink-2 hover:bg-panel-2 hover:text-ink`
            }
          >
            {label}
          </Link>
        ))}
      </nav>
      <Suspense key={current} fallback={<div className="h-[420px] animate-pulse rounded-2xl bg-panel" />}>
        {current === "defaults" ? (
          <DefaultsContent />
        ) : current === "security" ? (
          <SecurityContent />
        ) : current === "audit" ? (
          <AuditContent before={typeof before === "string" ? before : undefined} />
        ) : (
          <AccountContent />
        )}
      </Suspense>
    </div>
  );
}

export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <>
      <PageHead title="Settings" />
      <Suspense fallback={<div className="h-[420px] animate-pulse rounded-2xl bg-panel" />}>
        <SettingsBody searchParams={searchParams} />
      </Suspense>
    </>
  );
}
