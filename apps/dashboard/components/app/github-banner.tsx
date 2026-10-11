import type { OnboardingOutcome } from "@/lib/github-onboarding";
import { cn } from "@/lib/utils";

type Tone = "pass" | "warn" | "crit";

const MESSAGES: Record<OnboardingOutcome, { tone: Tone; title: string; body: string; action?: { href: string; label: string } }> = {
  connected: { tone: "pass", title: "GitHub connected", body: "" },
  synced: { tone: "pass", title: "Repositories updated", body: "Code Sentinel now matches what you chose on GitHub." },
  cancelled: {
    tone: "warn",
    title: "Nothing was connected",
    body: "GitHub didn't finish the authorization. Try again when you're ready.",
    action: { href: "/onboarding/github/install", label: "Install on GitHub" },
  },
  confirm: {
    tone: "warn",
    title: "Confirm it's you",
    body: "GitHub sent you back without the link we started, so nothing was connected. Confirm with GitHub to finish.",
    action: { href: "/onboarding/github/connect", label: "Finish connecting" },
  },
  unconfigured: {
    tone: "crit",
    title: "GitHub isn't set up on this server",
    body: "The GitHub App's client ID, secret or encryption key is missing. An admin needs to add them.",
  },
  code_invalid: {
    tone: "warn",
    title: "That link expired",
    body: "GitHub's authorization only works once, for a few minutes. Start again.",
    action: { href: "/onboarding/github/connect", label: "Connect GitHub" },
  },
  account_taken: {
    tone: "crit",
    title: "This GitHub account belongs to another user",
    body: "It's already linked to a different Code Sentinel account. Sign in with that one, or use another GitHub account.",
  },
  not_linked: {
    tone: "warn",
    title: "Connect GitHub first",
    body: "Your GitHub authorization is missing or has run out. Connect again to sync your repositories.",
    action: { href: "/onboarding/github/connect", label: "Connect GitHub" },
  },
  github_unavailable: {
    tone: "warn",
    title: "GitHub didn't answer",
    body: "Nothing changed. Try again in a moment.",
    action: { href: "/onboarding/github/connect", label: "Try again" },
  },
  failed: {
    tone: "crit",
    title: "Connecting GitHub failed",
    body: "Something went wrong on our side. Try again in a moment.",
    action: { href: "/onboarding/github/connect", label: "Try again" },
  },
};

const TONE: Record<Tone, string> = {
  pass: "border-pass/35 bg-pass/8",
  warn: "border-warn/35 bg-warn/8",
  crit: "border-crit/35 bg-crit/8",
};

export function isOnboardingOutcome(value: unknown): value is OnboardingOutcome {
  return typeof value === "string" && value in MESSAGES;
}

/** What happened on the way back from GitHub, in one sentence and at most one next step. */
export function GithubBanner({ outcome, repositories }: { outcome: OnboardingOutcome; repositories?: number }) {
  const message = MESSAGES[outcome];
  const body =
    outcome === "connected"
      ? repositories === 1
        ? "1 repository is ready. Open a pull request in it to get your first review."
        : `${repositories ?? 0} repositories are ready. Open a pull request in one to get your first review.`
      : message.body;
  return (
    <div role="status" className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border px-5 py-4", TONE[message.tone])}>
      <div className="grid min-w-[220px] flex-1 gap-0.5">
        <b className="font-bold">{message.title}</b>
        <span className="text-sm text-ink-2">{body}</span>
      </div>
      {message.action ? (
        <a href={message.action.href} className="rounded-[10px] border border-line-2 bg-panel-2 px-4 py-2 text-sm font-semibold hover:bg-panel-3">
          {message.action.label}
        </a>
      ) : null}
    </div>
  );
}
