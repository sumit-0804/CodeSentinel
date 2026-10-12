import picomatch from "picomatch";

/** Whether a pull request into `baseRef` is reviewed: `*` matches one path segment, `**` any number; case-sensitive. */
export function matchesReviewBranches(baseRef: string, patterns: readonly string[]): boolean {
  return patterns.length > 0 && picomatch(patterns as string[], { dot: true, nocase: false, windows: false })(baseRef);
}
