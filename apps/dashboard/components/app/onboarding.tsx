import { Check } from "lucide-react";
import { Gauge } from "@/components/brand/verdict";
import { Button } from "@/components/ui/button";
import { TextGenerateEffect } from "@/components/ui/text-generate-effect";
import { cn } from "@/lib/utils";

type Step = { title: string; detail: string; state: "done" | "now" | "next"; action?: React.ReactNode };

function StepRow({ step, index }: { step: Step; index: number }) {
  return (
    <li
      className={cn(
        "grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-[14px] border border-line bg-panel p-3.5",
        step.state === "now" && "border-cyan/40 shadow-[0_0_24px_-10px_rgb(61_240_255/0.6)]",
      )}
    >
      <span
        className={cn(
          "grid size-[30px] place-items-center rounded-full border-[1.5px] border-line-2 text-[13px] font-bold text-ink-3",
          step.state === "done" && "border-pass bg-pass text-[#052014] shadow-[0_0_12px_rgb(57_245_166/0.6)]",
          step.state === "now" && "border-cyan text-cyan",
        )}
      >
        {step.state === "done" ? <Check className="size-4" strokeWidth={3} aria-label="Done" /> : index + 1}
      </span>
      <div>
        <b className={cn("block font-bold", step.state === "done" && "text-ink-2 line-through decoration-ink-3")}>{step.title}</b>
        <span className="text-[13.5px] text-ink-2">{step.detail}</span>
      </div>
      {step.action}
    </li>
  );
}

/** First-run checklist: account, then the GitHub App on at least one repository, then a pull request. */
export function Onboarding({ signedInWith, connected = false }: { signedInWith: string; connected?: boolean }) {
  const steps: Step[] = [
    { title: "Create your account", detail: `Signed in with ${signedInWith}`, state: "done" },
    {
      title: "Install the app and pick repositories",
      detail: connected ? "Done. Add more any time from Repositories" : "On your account or an organization you manage",
      state: connected ? "done" : "now",
      ...(connected
        ? {}
        : {
            action: (
              // A route handler that redirects to GitHub: a plain link, so it isn't prefetched.
              <Button asChild variant="default">
                <a href="/onboarding/github/install">Install on GitHub</a>
              </Button>
            ),
          }),
    },
    {
      title: "Open a pull request",
      detail: "The verdict appears here and on GitHub within seconds",
      state: connected ? "now" : "next",
    },
  ];
  const done = steps.filter((step) => step.state === "done").length;

  return (
    <div className="panel">
      <div className="grid items-center gap-x-12 gap-y-8 p-[clamp(24px,4vw,44px)] min-[1041px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="grid gap-[18px]">
          <div className="flex items-center gap-3 text-[13.5px] text-ink-2">
            <span>Setup</span>
            <span className="h-1.5 max-w-[220px] flex-1 overflow-hidden rounded-full bg-panel-3">
              <span
                className="block h-full bg-[linear-gradient(90deg,var(--cs-violet),var(--cs-cyan))] shadow-[0_0_10px_rgb(61_240_255/0.6)]"
                style={{ width: `${(done / steps.length) * 100}%` }}
              />
            </span>
            <span className="tabular-nums">
              {done} of {steps.length}
            </span>
          </div>
          <h2 className="text-display text-[clamp(22px,2.6vw,30px)] leading-[1.2]">
            <TextGenerateEffect words={connected ? "Open your first pull request" : "Connect your first repository"} />
          </h2>
          <p className="max-w-[48ch] text-ink-2">
            Code Sentinel reviews pull requests in the repositories you pick and posts one verdict back to GitHub.
          </p>
          <ol className="grid gap-2.5">
            {steps.map((step, index) => (
              <StepRow key={step.title} step={step} index={index} />
            ))}
          </ol>
          <p className="text-[13px] text-ink-3">
            Already installed on an organization by someone else?{" "}
            <a href="/onboarding/github/connect" className="font-semibold text-cyan hover:underline">
              Connect GitHub
            </a>{" "}
            to join it.
          </p>
        </div>
        <div aria-hidden="true" className="grid gap-4 rounded-2xl border border-dashed border-line-2 bg-[rgb(5_6_11/0.5)] p-6">
          <span className="text-[13px] font-semibold text-ink-3">What a clean review looks like</span>
          <span className="text-display text-xl leading-tight">Passed. Nothing blocks this merge.</span>
          <Gauge size="sm" lanes={["ok", "ok", "ok", "ok", "ok"]} />
        </div>
      </div>
    </div>
  );
}
