import { describe, expect, it, vi } from "vitest";

import type { Finding, ReviewJob } from "@code-sentinel/contracts";
import { noopLogger } from "@code-sentinel/service-kit";
import { captureLogger } from "@code-sentinel/service-kit/testing";
import { OrchestratorCallError } from "../orchestrator/orchestrator-call-error.js";
import type { ReviewComment } from "./github-client.js";
import { ReviewPublisher, type FollowInput } from "./review-publisher.js";
import { StubGitHubClient } from "./stub-github-client.js";

const REF = { installationId: 42, owner: "octo", repo: "playground", pullNumber: 1 };
const INPUT: FollowInput = {
  ref: REF,
  headSha: "f3326e0",
  jobId: "0f7e2c1a-9b3d-4e5f-8a6b-1c2d3e4f5a6b",
  reviewId: "8f1c3a92-4c1e-4c22-9a0e-6f2f4b9d0a11",
  requestId: "req-1",
  threshold: 0.8,
  blockingAgents: ["security"],
  postInlineComments: true,
};

const sqli: Finding = {
  agent: "security",
  ruleId: "security/sql-injection",
  title: "SQL built from string formatting",
  description: "Use parameters.",
  location: { filePath: "app/payments.py", lineStart: 14, lineEnd: 14 },
  severity: "critical",
  confidence: 0.85,
  cweId: "CWE-89",
};

function job(status: ReviewJob["status"], findings: Finding[] = [sqli]): ReviewJob {
  const done = ["completed", "partial"].includes(status);
  return {
    jobId: INPUT.jobId,
    reviewId: INPUT.reviewId,
    status,
    createdAt: "2026-09-27T12:00:00Z",
    ...(done
      ? {
          report: {
            reviewId: INPUT.reviewId,
            status: status === "partial" ? "partial" : "completed",
            summary: { criticalCount: 1, warningCount: 0, infoCount: 0, autoFixedCount: 0, suggestedFixCount: 0 },
            findings,
            agentRuns: [{ agent: "security", status: "succeeded", findingsCount: findings.length, latencyMs: 900 }],
          },
        }
      : {}),
  };
}

/** A publisher on a fake clock: every `sleep` advances time, so polling and timeouts run instantly. */
function publisher(jobs: Array<ReviewJob | Error>, github = new StubGitHubClient(), logger = noopLogger, timeoutMs = 300_000) {
  let now = 0;
  const getReviewJob = vi.fn(async () => {
    const next = jobs.length > 1 ? jobs.shift()! : jobs[0]!;
    if (next instanceof Error) throw next;
    return next;
  });
  const recordCheckRun = vi.fn(async () => {});
  const p = new ReviewPublisher({
    github,
    orchestrator: { getReviewJob },
    logger,
    reviews: { recordCheckRun },
    pollIntervalMs: 2_000,
    timeoutMs,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  return { p, github, getReviewJob, recordCheckRun };
}

describe("ReviewPublisher", () => {
  it("stores the Check Run's conclusion on the review for the dashboard", async () => {
    const { p, github, recordCheckRun } = publisher([job("completed")]);

    await p.follow(INPUT);

    expect(recordCheckRun).toHaveBeenCalledWith(INPUT.reviewId, { checkRunId: github.checkRuns[0]!.id, conclusion: "fail" });
  });

  it("still finishes when storing the conclusion fails", async () => {
    const { p, github, recordCheckRun } = publisher([job("completed", [])]);
    recordCheckRun.mockRejectedValueOnce(new Error("database down"));

    await expect(p.follow(INPUT)).resolves.toBeUndefined();
    expect(github.checkRuns[0]).toMatchObject({ status: "completed", conclusion: "success" });
  });

  it("opens a Check Run, polls the job, posts one review, then completes the Check Run", async () => {
    const { p, github, getReviewJob } = publisher([job("queued"), job("running"), job("completed")]);

    await p.follow(INPUT);

    expect(getReviewJob).toHaveBeenCalledTimes(3);
    expect(github.reviews).toEqual([
      { ref: REF, commitId: "f3326e0", body: expect.stringContaining("posted 1 comment"), comments: [expect.objectContaining({ path: "app/payments.py", line: 14 })] },
    ]);
    expect(github.checkRuns).toEqual([
      expect.objectContaining({ name: "Code-Sentinel", headSha: "f3326e0", status: "completed", conclusion: "failure" }),
    ]);
    expect(github.checkRuns[0]!.output?.annotations).toHaveLength(1);
  });

  it("completes the Check Run as neutral when the job does not finish in time", async () => {
    const { p, github } = publisher([job("running")], undefined, noopLogger, 10_000);

    await p.follow(INPUT);

    expect(github.checkRuns[0]).toMatchObject({ conclusion: "neutral", output: { title: "Review timed out" } });
    expect(github.reviews).toEqual([]);
  });

  it("keeps polling through orchestrator errors, and stops when the job is gone", async () => {
    const flaky = publisher([new OrchestratorCallError("down", { kind: "network", latencyMs: 1 }), job("completed")]);
    await flaky.p.follow(INPUT);
    expect(flaky.github.checkRuns[0]?.conclusion).toBe("failure");

    const gone = publisher([new OrchestratorCallError("404", { kind: "http", status: 404, latencyMs: 1 })]);
    await gone.p.follow(INPUT);
    expect(gone.getReviewJob).toHaveBeenCalledTimes(1);
    expect(gone.github.checkRuns[0]?.conclusion).toBe("neutral");
  });

  it("posts comments one by one when GitHub refuses the review, and reports the ones that failed", async () => {
    const github = new StubGitHubClient();
    const second = { ...sqli, location: { filePath: "app/payments.py", lineStart: 99, lineEnd: 99 } };
    const create = vi.spyOn(github, "createReview").mockImplementation(async (_ref, input: { comments: ReviewComment[] }) => {
      if (input.comments.some((c) => c.line === 99)) throw Object.assign(new Error("Unprocessable"), { status: 422 });
    });
    const { p } = publisher([job("completed", [sqli, second])], github);

    await p.follow(INPUT);

    expect(create).toHaveBeenCalledTimes(3);
    expect(github.checkRuns[0]!.output?.summary).toContain("1 inline comment could not be placed on the diff: `app/payments.py:99`.");
  });

  it("skips inline comments when the repository turned them off, and still posts them if the Check Run failed", async () => {
    const off = publisher([job("completed")]);
    await off.p.follow({ ...INPUT, postInlineComments: false });
    expect(off.github.reviews).toEqual([]);
    expect(off.github.checkRuns[0]?.status).toBe("completed");

    const github = new StubGitHubClient();
    vi.spyOn(github, "createCheckRun").mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    const { logger, lines } = captureLogger();
    const noCheck = publisher([job("completed")], github, logger);
    await noCheck.p.follow(INPUT);
    expect(github.reviews).toHaveLength(1);
    expect(lines.some((line) => line.message === "could not create the Check Run" && line.status === 403)).toBe(true);
  });

  it("completes a cancelled job's Check Run as superseded, without comments", async () => {
    const { p, github, recordCheckRun } = publisher([job("running"), job("cancelled")]);

    await p.follow(INPUT);

    expect(github.checkRuns[0]).toMatchObject({ conclusion: "neutral", output: { title: "Superseded by a newer commit" } });
    expect(github.reviews).toEqual([]);
    expect(recordCheckRun).toHaveBeenCalledWith(INPUT.reviewId, { checkRunId: github.checkRuns[0]!.id, conclusion: "neutral" });
  });

  it("posts a neutral Nothing to review Check Run, and never throws", async () => {
    const { p, github } = publisher([job("completed")]);

    await p.nothingToReview({ ref: REF, headSha: "f3326e0", skippedFiles: [{ path: "package-lock.json", reason: "generated_file" }], requestId: "req-2" });

    expect(github.checkRuns).toEqual([
      expect.objectContaining({ headSha: "f3326e0", status: "completed", conclusion: "neutral", output: expect.objectContaining({ title: "Nothing to review" }) }),
    ]);
    expect(github.checkRuns[0]!.output?.summary).toContain("- `package-lock.json` — generated or vendored");

    const failing = new StubGitHubClient();
    vi.spyOn(failing, "createCheckRun").mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    await expect(publisher([], failing).p.nothingToReview({ ref: REF, headSha: "x", skippedFiles: [], requestId: "r" })).resolves.toBeUndefined();
  });

  it("never throws, even when completing the Check Run fails", async () => {
    const github = new StubGitHubClient();
    vi.spyOn(github, "completeCheckRun").mockRejectedValue(new Error("boom"));
    const { logger, lines } = captureLogger();
    const { p } = publisher([job("completed")], github, logger);

    await expect(p.follow(INPUT)).resolves.toBeUndefined();
    expect(lines.some((line) => line.message === "publishing the review to GitHub failed")).toBe(true);
  });
});
