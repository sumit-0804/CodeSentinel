import { WebhookAcceptedSchema } from "@code-sentinel/contracts";
import { captureLogger, withServer } from "@code-sentinel/service-kit/testing";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import type { InstallationRepository } from "../github/github-client.js";
import { StubGitHubClient } from "../github/stub-github-client.js";
import { pullRequestEventPayload, seededStores, signedWebhookHeaders, testAppDeps } from "../test-support/fixtures.js";

const INSTALLATION = 77;
const ACCOUNT = { id: 900, login: "octo-org", type: "Organization" };
const repo = (id: number, fullName: string): InstallationRepository => ({ id, fullName, defaultBranch: "main", isPrivate: false });

async function setup() {
  const { logger, lines } = captureLogger();
  const { stores } = await seededStores();
  const github = new StubGitHubClient();
  github.installationRepositories.set(INSTALLATION, [repo(501, "octo-org/api"), repo(502, "octo-org/web")]);
  const app = createApp(testAppDeps({ logger, stores, github }));

  let delivery = 0;
  async function deliver(event: string, payload: unknown) {
    const body = JSON.stringify(payload);
    delivery += 1;
    let result!: { status: number; body: Record<string, unknown> };
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/webhooks/github`, {
        method: "POST",
        headers: signedWebhookHeaders(body, undefined, { event, delivery: `00000000-0000-4000-8000-${String(delivery).padStart(12, "0")}` }),
        body,
      });
      result = { status: response.status, body: (await response.json()) as Record<string, unknown> };
    });
    return result;
  }

  const installed = async () => {
    const found = await stores.repositories.findByGithubRepoId(501);
    return found ? (await stores.repositories.listForOrganization(found.organizationId)).map((r) => r.fullName) : [];
  };

  return { stores, github, lines, deliver, installed };
}

const installationEvent = (action: string, extra: Record<string, unknown> = {}) => ({
  action,
  installation: { id: INSTALLATION, account: ACCOUNT, ...extra },
});

describe("installation webhooks", () => {
  it("syncs the account and its repositories when the App is installed", async () => {
    const { deliver, installed, lines } = await setup();

    const { status, body } = await deliver("installation", installationEvent("created"));

    expect(status).toBe(202);
    expect(WebhookAcceptedSchema.parse(body).action).toBe("installation_synced");
    expect(await installed()).toEqual(["octo-org/api", "octo-org/web"]);
    expect(lines.at(-1)).toMatchObject({ event: "installation", outcome: "installation_synced" });
  });

  it("marks everything removed on uninstall, so its pull requests are ignored", async () => {
    const { deliver, stores } = await setup();
    await deliver("installation", installationEvent("created"));

    const { body } = await deliver("installation", installationEvent("deleted"));

    expect(body.action).toBe("installation_synced");
    await expect(stores.repositories.findByGithubRepoId(501)).resolves.toBeUndefined();
    const review = await deliver("pull_request", pullRequestEventPayload({ repository: { id: 501, full_name: "octo-org/api", name: "api", owner: { login: "octo-org" } } }));
    expect(review.body.action).toBe("event_ignored");
  });

  it("pauses reviews while suspended and resumes on unsuspend", async () => {
    const { deliver, stores } = await setup();
    await deliver("installation", installationEvent("created"));

    await deliver("installation", installationEvent("suspend", { suspended_at: "2026-10-11T10:00:00Z" }));
    await expect(stores.repositories.findByGithubRepoId(501)).resolves.toBeUndefined();

    await deliver("installation", installationEvent("unsuspend"));
    await expect(stores.repositories.findByGithubRepoId(501)).resolves.toBeDefined();
  });

  it("follows repositories being added to and removed from the installation", async () => {
    const { deliver, github, installed } = await setup();
    await deliver("installation", installationEvent("created"));

    await deliver("installation_repositories", { ...installationEvent("removed"), repositories_removed: [{ id: 502, full_name: "octo-org/web" }] });
    expect(await installed()).toEqual(["octo-org/api"]);

    github.installationRepositories.set(INSTALLATION, [repo(501, "octo-org/api"), repo(502, "octo-org/web"), repo(503, "octo-org/docs")]);
    await deliver("installation_repositories", { ...installationEvent("added"), repositories_added: [{ id: 503 }] });
    expect(await installed()).toEqual(["octo-org/api", "octo-org/docs", "octo-org/web"]);
  });

  it("acknowledges other installation actions and rejects a malformed payload", async () => {
    const { deliver } = await setup();

    expect((await deliver("installation", installationEvent("new_permissions_accepted"))).body.action).toBe("installation_synced");
    expect((await deliver("installation", installationEvent("renamed"))).body.action).toBe("event_ignored");
    const bad = await deliver("installation", { action: "created", installation: { id: "not-a-number" } });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("invalid_payload");
  });

  it("answers 502 when GitHub fails during the sync, so the delivery can be retried", async () => {
    const { deliver, github } = await setup();
    github.listInstallationRepositories = async () => {
      throw Object.assign(new Error("GitHub is down"), { status: 503 });
    };

    const { status, body } = await deliver("installation", installationEvent("created"));

    expect(status).toBe(502);
    expect(body.code).toBe("github_unavailable");
  });
});
