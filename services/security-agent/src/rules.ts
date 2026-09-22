import type { CapabilityRule, Language, Severity } from "@code-sentinel/contracts";

export interface CodeRule {
  ruleId: string;
  title: string;
  description: string;
  severity: Severity;
  confidence: number;
  cweId: string;
  languages: readonly Language[];
  pattern: RegExp;
}

const PY: readonly Language[] = ["python"];
const JS: readonly Language[] = ["javascript", "typescript"];

/** User-controlled input as it usually appears in a request handler. */
const PY_INPUT = String.raw`\b(?:request\.|input\(|sys\.argv|params\[|args\.get|kwargs\[)`;
const JS_INPUT = String.raw`\b(?:req|request)\.(?:params|query|body|headers|cookies)\b`;

/**
 * SAST rules (FR-SEC-01), matched against one added line at a time. Patterns favour precision over
 * recall: the LLM pass is there for what a single line cannot show.
 */
export const CODE_RULES: readonly CodeRule[] = [
  {
    ruleId: "security/sql-injection",
    title: "SQL built from string formatting",
    description: "The query text is assembled from variables. Pass values as query parameters so the driver escapes them.",
    severity: "critical",
    confidence: 0.85,
    cweId: "CWE-89",
    languages: PY,
    pattern: /\.(?:execute|executemany|raw)\s*\(\s*(?:f["']|["'][^"']*["']\s*(?:%|\+|\.format\s*\())/,
  },
  {
    ruleId: "security/sql-injection",
    title: "SQL built from string interpolation",
    description: "The query text is assembled from variables. Pass values as query parameters (placeholders) instead.",
    severity: "critical",
    confidence: 0.85,
    cweId: "CWE-89",
    languages: JS,
    pattern: /\.(?:query|execute|raw|\$queryRawUnsafe|\$executeRawUnsafe)\s*\(\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+)/,
  },
  {
    ruleId: "security/command-injection",
    title: "Shell command with shell=True",
    description: "Running through the shell lets crafted input chain extra commands. Pass an argument list and drop shell=True.",
    severity: "critical",
    confidence: 0.8,
    cweId: "CWE-78",
    languages: PY,
    pattern: /\bsubprocess\.(?:run|call|Popen|check_output|check_call)\s*\(.*\bshell\s*=\s*True/,
  },
  {
    ruleId: "security/command-injection",
    title: "Shell command via os.system or os.popen",
    description: "os.system and os.popen run a shell string. Use subprocess with an argument list.",
    severity: "warning",
    confidence: 0.7,
    cweId: "CWE-78",
    languages: PY,
    pattern: /\bos\.(?:system|popen)\s*\(/,
  },
  {
    ruleId: "security/command-injection",
    title: "Shell command built from a string",
    description: "exec runs a shell string assembled from variables. Use execFile or spawn with an argument array.",
    severity: "critical",
    confidence: 0.8,
    cweId: "CWE-78",
    languages: JS,
    pattern: /\bexec(?:Sync)?\s*\(\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+)/,
  },
  {
    ruleId: "security/insecure-deserialization",
    title: "Untrusted pickle / marshal data",
    description: "Unpickling runs arbitrary code from the data. Use a safe format such as JSON for anything not produced by this process.",
    severity: "critical",
    confidence: 0.8,
    cweId: "CWE-502",
    languages: PY,
    pattern: /\b(?:pickle|cPickle|marshal|dill)\.loads?\s*\(/,
  },
  {
    ruleId: "security/insecure-deserialization",
    title: "yaml.load without a safe loader",
    description: "yaml.load with the default loader can build arbitrary objects. Use yaml.safe_load or Loader=yaml.SafeLoader.",
    severity: "critical",
    confidence: 0.85,
    cweId: "CWE-502",
    languages: PY,
    pattern: /\byaml\.(?:load|load_all)\s*\((?![^)]*Safe)/,
  },
  {
    ruleId: "security/insecure-deserialization",
    title: "node-serialize unserialize",
    description: "unserialize evaluates functions embedded in the payload. Parse untrusted data with JSON.parse.",
    severity: "critical",
    confidence: 0.85,
    cweId: "CWE-502",
    languages: JS,
    pattern: /\bunserialize\s*\(/,
  },
  {
    ruleId: "security/code-injection",
    title: "Dynamic code execution",
    description: "eval / exec run a string as code. Replace with explicit parsing or a lookup table.",
    severity: "warning",
    confidence: 0.75,
    cweId: "CWE-95",
    languages: PY,
    pattern: /(?<![\w.])(?:eval|exec)\s*\(/,
  },
  {
    ruleId: "security/code-injection",
    title: "Dynamic code execution",
    description: "eval / new Function run a string as code. Replace with explicit parsing or a lookup table.",
    severity: "warning",
    confidence: 0.75,
    cweId: "CWE-95",
    languages: JS,
    pattern: /(?<![\w.])eval\s*\(|\bnew\s+Function\s*\(/,
  },
  {
    ruleId: "security/xss",
    title: "HTML written without escaping",
    description: "Assigning to innerHTML / outerHTML or calling document.write renders markup as-is. Use textContent or sanitise first.",
    severity: "warning",
    confidence: 0.7,
    cweId: "CWE-79",
    languages: JS,
    pattern: /\.(?:innerHTML|outerHTML)\s*\+?=(?!=)|\bdocument\.write(?:ln)?\s*\(|\binsertAdjacentHTML\s*\(/,
  },
  {
    ruleId: "security/xss",
    title: "dangerouslySetInnerHTML",
    description: "React renders this HTML without escaping. Sanitise it (for example with DOMPurify) or render text instead.",
    severity: "warning",
    confidence: 0.7,
    cweId: "CWE-79",
    languages: JS,
    pattern: /\bdangerouslySetInnerHTML\s*=/,
  },
  {
    ruleId: "security/xss",
    title: "Template output marked safe",
    description: "Marking request data as safe disables auto-escaping. Escape it, or keep it out of mark_safe / |safe.",
    severity: "warning",
    confidence: 0.65,
    cweId: "CWE-79",
    languages: PY,
    pattern: new RegExp(String.raw`\b(?:mark_safe|Markup)\s*\(.*` + PY_INPUT),
  },
  {
    ruleId: "security/path-traversal",
    title: "File path from request data",
    description: "A path built from request data can escape the intended folder with ../. Resolve it and check it stays inside a fixed base directory.",
    severity: "warning",
    confidence: 0.7,
    cweId: "CWE-22",
    languages: PY,
    pattern: new RegExp(String.raw`\b(?:open|send_file|os\.path\.join|Path)\s*\(.*` + PY_INPUT),
  },
  {
    ruleId: "security/path-traversal",
    title: "File path from request data",
    description: "A path built from request data can escape the intended folder with ../. Resolve it and check it stays inside a fixed base directory.",
    severity: "warning",
    confidence: 0.7,
    cweId: "CWE-22",
    languages: JS,
    pattern: new RegExp(
      String.raw`\b(?:readFile|readFileSync|createReadStream|writeFile|writeFileSync|sendFile|unlink|path\.join|path\.resolve)\s*\(.*` + JS_INPUT,
    ),
  },
];

/** A line that is only a comment; code rules skip it, secret rules do not. */
export function isCommentLine(text: string, language: Language): boolean {
  const trimmed = text.trimStart();
  if (language === "python") return trimmed.startsWith("#");
  return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
}

/** The rule list advertised on `/v1/capabilities`, one entry per rule id. */
export function capabilityRules(secretRules: ReadonlyArray<{ ruleId: string; title: string }>): CapabilityRule[] {
  const seen = new Map<string, CapabilityRule>();
  for (const rule of CODE_RULES) {
    if (!seen.has(rule.ruleId)) seen.set(rule.ruleId, { ruleId: rule.ruleId, title: rule.title, defaultSeverity: rule.severity });
  }
  for (const rule of secretRules) {
    if (!seen.has(rule.ruleId)) seen.set(rule.ruleId, { ruleId: rule.ruleId, title: rule.title, defaultSeverity: "critical" });
  }
  return [...seen.values()];
}
