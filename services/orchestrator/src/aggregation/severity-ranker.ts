import type { Finding, Severity } from "../types.js";

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

/**
 * Orders findings by severity, then by confidence within a severity band (FR-ORC-04).
 * The combined report is presented in this order across all three clients.
 */
export class SeverityRanker {
  rank(findings: Finding[]): Finding[] {
    return [...findings].sort((a, b) => {
      const bySeverity = this.weight(b.severity) - this.weight(a.severity);
      if (bySeverity !== 0) return bySeverity;
      return b.confidence - a.confidence;
    });
  }

  private weight(severity: Severity): number {
    return SEVERITY_WEIGHT[severity];
  }
}
