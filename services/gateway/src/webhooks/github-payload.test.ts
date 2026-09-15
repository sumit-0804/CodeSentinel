import { describe, expect, it } from "vitest";

import { pullRequestEventPayload } from "../test-support/fixtures.js";
import { PullRequestEventSchema } from "./github-payload.js";

describe("PullRequestEventSchema", () => {
  it("parses the fixture and strips keys the gateway does not read", () => {
    const event = PullRequestEventSchema.parse(pullRequestEventPayload());

    expect(event).toMatchObject({ action: "opened", number: 42, repository: { id: 123456789, name: "consumer-api" } });
    expect(event).not.toHaveProperty("sender");
  });

  it("rejects a payload without repository.id", () => {
    const payload = pullRequestEventPayload();
    const { id: _id, ...repository } = payload.repository as Record<string, unknown>;

    expect(PullRequestEventSchema.safeParse({ ...payload, repository }).success).toBe(false);
  });

  it("rejects a non-integer number", () => {
    expect(PullRequestEventSchema.safeParse(pullRequestEventPayload({ number: 4.2 })).success).toBe(false);
  });
});
