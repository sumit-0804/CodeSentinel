import type { SVGProps } from "react";

/** `agent` is the API's name for it; `live` is false until the agent is deployed. */
export const AGENTS = [
  { key: "SEC", agent: "security", name: "Security", what: "Leaked secrets, injection and unsafe input.", live: true },
  { key: "STY", agent: "style", name: "Style", what: "ESLint, Prettier, Ruff and Black, with exact fixes.", live: true },
  { key: "PRF", agent: "performance", name: "Performance", what: "Slow loops, repeated queries, needless allocations.", live: true },
  { key: "LGC", agent: "logic", name: "Logic", what: "Wrong conditions, off-by-one errors, missed edge cases.", live: true },
  { key: "DOC", agent: "documentation", name: "Documentation", what: "Missing or incomplete docstrings on public code.", live: true },
] as const;

export type AgentKey = (typeof AGENTS)[number]["key"];

const common: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export function AgentGlyph({ agent, className }: { agent: AgentKey; className?: string }) {
  switch (agent) {
    case "SEC":
      return (
        <svg {...common} className={className}>
          <path d="M12 3 19 6v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "STY":
      return (
        <svg {...common} className={className}>
          <path d="M4 20c2.5 0 4-1.5 4-3.5S9.5 13 11 13l9-9-2-2-9 9c0 1.5-1.5 3-3.5 3S4 17.5 4 20Z" />
        </svg>
      );
    case "PRF":
      return (
        <svg {...common} className={className}>
          <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
        </svg>
      );
    case "LGC":
      return (
        <svg {...common} className={className}>
          <circle cx="6" cy="5" r="2" />
          <circle cx="6" cy="19" r="2" />
          <circle cx="18" cy="12" r="2" />
          <path d="M6 7v10M8 6c5 0 8 2 8 6M8 18c5 0 8-2 8-6" />
        </svg>
      );
    case "DOC":
      return (
        <svg {...common} className={className}>
          <path d="M5 4h9l5 5v11H5z" />
          <path d="M14 4v5h5M8 13h8M8 17h6" />
        </svg>
      );
  }
}
