export interface SecretMatch {
  ruleId: string;
  title: string;
  /** Start and end of the secret value inside the line. */
  start: number;
  end: number;
  confidence: number;
}

interface SecretPattern {
  ruleId: string;
  title: string;
  pattern: RegExp;
  confidence: number;
  /** Capture group holding the secret; the whole match when absent. */
  group?: number;
}

/** Provider-issued token formats: distinctive prefixes, so false positives are rare. */
const PATTERNS: SecretPattern[] = [
  { ruleId: "security/secret-aws-access-key", title: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, confidence: 0.95 },
  { ruleId: "security/secret-github-token", title: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g, confidence: 0.95 },
  { ruleId: "security/secret-google-api-key", title: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, confidence: 0.9 },
  { ruleId: "security/secret-slack-token", title: "Slack token", pattern: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/g, confidence: 0.9 },
  { ruleId: "security/secret-stripe-key", title: "Stripe live key", pattern: /\b[sr]k_live_[0-9A-Za-z]{20,}\b/g, confidence: 0.95 },
  { ruleId: "security/secret-groq-key", title: "Groq API key", pattern: /\bgsk_[0-9A-Za-z]{40,}\b/g, confidence: 0.9 },
  { ruleId: "security/secret-private-key", title: "Private key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g, confidence: 0.95 },
  {
    ruleId: "security/secret-hardcoded-credential",
    title: "Hardcoded credential",
    // Key names like DB_PASSWORD or stripeApiKey: `_` is a word character, so no \b before the keyword.
    pattern: /[\w.-]*(?:password|passwd|pwd|secret|api[_-]?key|auth[_-]?token|access[_-]?token)[\w.-]*["']?\s*[:=]\s*["']([^"'\s]{8,})["']/gi,
    group: 1,
    confidence: 0.7,
  },
];

/** Secret rule ids and titles, for `/v1/capabilities`. */
export const SECRET_RULES: ReadonlyArray<{ ruleId: string; title: string }> = PATTERNS.map(({ ruleId, title }) => ({ ruleId, title }));

/** Values that look like placeholders or references, not real secrets. */
const PLACEHOLDER = /^(?:x+|\*+|changeme|password|secret|example|dummy|test|sample|placeholder|your[_-]|<|\$\{|\{\{|%\(|process\.env|os\.environ)/i;

/** Every secret on one line, with its position so it can be masked. */
export function findSecrets(line: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const { ruleId, title, pattern, confidence, group } of PATTERNS) {
    for (const match of line.matchAll(pattern)) {
      const value = group === undefined ? match[0] : match[group];
      if (value === undefined) continue;
      if (group !== undefined && (PLACEHOLDER.test(value) || entropy(value) < 3)) continue;
      const start = match.index + match[0].indexOf(value);
      if (matches.some((existing) => start < existing.end && existing.start < start + value.length)) continue;
      matches.push({ ruleId, title, start, end: start + value.length, confidence });
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}

/** `AKIAIOSFODNN7EXAMPLE` → `AKIA****`. The rest of the value never leaves the agent. */
export function maskValue(value: string): string {
  return `${value.slice(0, Math.min(4, Math.floor(value.length / 4)))}****`;
}

/** The line with every secret masked; used before anything is logged, reported or sent to an LLM. */
export function maskSecrets(line: string): string {
  let masked = line;
  for (const match of findSecrets(line).reverse()) {
    masked = masked.slice(0, match.start) + maskValue(line.slice(match.start, match.end)) + masked.slice(match.end);
  }
  return masked;
}

/** Shannon entropy in bits per character; random keys score above ~3.5, words below ~3. */
function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}
