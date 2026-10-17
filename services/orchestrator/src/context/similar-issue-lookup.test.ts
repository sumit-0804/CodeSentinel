import { describe, expect, it, vi } from "vitest";

import type { Finding, SimilarPastIssue } from "@code-sentinel/contracts";
import { EXAMPLE_ORGANIZATION_ID, EXAMPLE_REVIEW_ID, exampleFinding } from "@code-sentinel/contracts/examples";
import { SimilarIssueLookup } from "./similar-issue-lookup.js";
import type { VectorRepository } from "./vector-repository.js";

const scope = { organizationId: EXAMPLE_ORGANIZATION_ID, reviewId: EXAMPLE_REVIEW_ID, confidenceThreshold: 0.8 };
const past: SimilarPastIssue[] = [{ findingId: "3f0e2a5c-9d1b-4f7a-8c6e-5b4a3d2c1e0f", similarityScore: 0.9, title: "Earlier" }];

function finding(n: number, confidence = 0.9): Finding {
  return { ...exampleFinding, id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, title: `Finding ${n}`, confidence };
}

function repository(querySimilar: VectorRepository["querySimilar"] = async () => past): VectorRepository {
  return { querySimilar: vi.fn(querySimilar), index: vi.fn(async () => undefined) };
}

describe("SimilarIssueLookup", () => {
  it("looks up only findings above the threshold, at most maxFindings of them", async () => {
    const vectors = repository();
    const lookup = new SimilarIssueLookup(vectors, { maxFindings: 2 });

    const findings = [finding(1), finding(2, 0.5), finding(3), finding(4)];
    const result = await lookup.attach(findings, scope);

    expect(vectors.querySimilar).toHaveBeenCalledTimes(2);
    expect(result.map((f) => f.similarPastIssues?.length ?? 0)).toEqual([1, 0, 1, 0]);
  });

  it("returns findings unchanged when a lookup fails or finds nothing", async () => {
    let call = 0;
    const lookup = new SimilarIssueLookup(
      repository(async () => {
        call += 1;
        if (call === 1) throw new Error("embedding quota is full");
        return [];
      }),
    );

    const findings = [finding(1), finding(2)];
    expect(await lookup.attach(findings, scope)).toEqual(findings);
  });

  it("gives up on lookups still running at the time limit", async () => {
    const hanging = new Promise<SimilarPastIssue[]>(() => undefined);
    const lookup = new SimilarIssueLookup(repository(() => hanging), { timeoutMs: 20 });

    const started = Date.now();
    const result = await lookup.attach([finding(1)], scope);

    expect(result[0]).not.toHaveProperty("similarPastIssues");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("indexes the same findings it looked up and counts failures", async () => {
    const vectors = repository();
    vi.mocked(vectors.index).mockRejectedValueOnce(new Error("no row"));
    const lookup = new SimilarIssueLookup(vectors, { maxFindings: 3 });

    const failed = await lookup.index([finding(1), finding(2, 0.1), finding(3), { ...exampleFinding }], {
      organizationId: EXAMPLE_ORGANIZATION_ID,
      confidenceThreshold: 0.8,
    });

    expect(failed).toBe(1);
    expect(vi.mocked(vectors.index).mock.calls.map(([f]) => f.title)).toEqual(["Finding 1", "Finding 3"]);
  });
});
