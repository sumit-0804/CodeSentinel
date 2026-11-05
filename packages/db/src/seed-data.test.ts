import { describe, expect, it } from "vitest";

import {
  DEFAULT_DEV_ENCRYPTION_KEY,
  EMBEDDING_DIMENSIONS,
  SEED_IDS,
  buildDeterministicEmbedding,
  formatVectorLiteral,
  parseRepositoryOverride,
} from "./seed-data.js";
import { SecretBox } from "./secret-box.js";

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i]!;
    const vb = b[i]!;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

describe("seed-data helpers", () => {
  it("preserves the canonical primary IDs shared with contracts and dev-seed", () => {
    expect(SEED_IDS.organizations.codeSentinel).toBe("7d9e1f2a-3b4c-4d5e-8f60-718293a4b5c6");
    expect(SEED_IDS.repositories.consumerApi).toBe("2b0c6b0e-0b1a-4f6e-9c3d-1a2b3c4d5e6f");
    expect(SEED_IDS.installations.codeSentinel).toBe("9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d");
    expect(SEED_IDS.users.octoDev).toBe("3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f");
  });

  it("parses SEED_GITHUB_REPOSITORY overrides and rejects malformed values", () => {
    expect(parseRepositoryOverride()).toEqual({
      fullName: "code-sentinel/consumer-api",
      githubRepoId: 123456789n,
    });
    expect(parseRepositoryOverride("  sumit-0804/code-sentinel-playground:1390792507  ")).toEqual({
      fullName: "sumit-0804/code-sentinel-playground",
      githubRepoId: 1390792507n,
    });
    expect(() => parseRepositoryOverride("invalid-repo-format")).toThrow(
      "SEED_GITHUB_REPOSITORY must look like owner/name:githubRepoId",
    );
  });

  it("builds normalized 768-dimension embeddings with high intra-cluster similarity and low cross-cluster similarity", () => {
    const sqliA = buildDeterministicEmbedding(1, 0);
    const sqliB = buildDeterministicEmbedding(1, 1);
    const perfA = buildDeterministicEmbedding(2, 0);

    expect(sqliA).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(sqliB).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(perfA).toHaveLength(EMBEDDING_DIMENSIONS);

    const sameClusterScore = cosineSimilarity(sqliA, sqliB);
    const crossClusterScore = cosineSimilarity(sqliA, perfA);

    expect(sameClusterScore).toBeGreaterThan(0.88);
    expect(crossClusterScore).toBeLessThan(0.2);

    const literal = formatVectorLiteral(sqliA);
    expect(literal.startsWith("[")).toBe(true);
    expect(literal.endsWith("]")).toBe(true);
    expect(() => formatVectorLiteral([1, 2, 3])).toThrow(/Expected 768-dimension vector/);
  });

  it("provides a valid 32-byte default dev encryption key for SecretBox", () => {
    const box = new SecretBox(DEFAULT_DEV_ENCRYPTION_KEY);
    const sealed = box.seal("ghu_test_token");
    expect(box.open(sealed)).toBe("ghu_test_token");
  });
});
