import { describe, expect, it } from "vitest";

import { issueKey } from "./cwe-families.js";

describe("issueKey", () => {
  it("puts sibling CWEs of one weakness under the same key", () => {
    expect(issueKey({ ruleId: "rule", cweId: "CWE-798" })).toBe(issueKey({ ruleId: "llm", cweId: "CWE-321" }));
    expect(issueKey({ ruleId: "rule", cweId: "CWE-89" })).toBe(issueKey({ ruleId: "llm", cweId: "CWE-564" }));
  });

  it("keeps different weaknesses apart", () => {
    expect(issueKey({ ruleId: "a", cweId: "CWE-798" })).not.toBe(issueKey({ ruleId: "b", cweId: "CWE-89" }));
    expect(issueKey({ ruleId: "a", cweId: "CWE-22" })).not.toBe(issueKey({ ruleId: "b", cweId: "CWE-79" }));
  });

  it("falls back to the CWE itself when it has no family, then to the rule id", () => {
    expect(issueKey({ ruleId: "a", cweId: "CWE-1004" })).toBe("CWE-1004");
    expect(issueKey({ ruleId: "security/eval" })).toBe("security/eval");
  });
});
