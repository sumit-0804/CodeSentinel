import { describe, expect, it } from "vitest";

import { healthByAgent, healthNotice } from "./agent-health-view";

const NAMES = { security: "Security", style: "Style", performance: "Performance", logic: "Logic", documentation: "Documentation" } as const;

describe("healthNotice", () => {
  it("says nothing when every agent is fine", () => {
    expect(healthNotice({ agents: [{ agent: "security", status: "ok" }] }, NAMES)).toBeUndefined();
  });

  it("names the agents that aren't answering before slow ones", () => {
    const notice = healthNotice(
      {
        agents: [
          { agent: "logic", status: "unavailable" },
          { agent: "performance", status: "unavailable" },
          { agent: "security", status: "degraded" },
        ],
      },
      NAMES,
    );
    expect(notice).toMatchObject({ tone: "crit", title: "Logic and Performance aren't answering" });
  });

  it("only counts the agents a repository runs, and admits when nothing could be checked", () => {
    const health = { agents: [{ agent: "logic" as const, status: "unavailable" as const }, { agent: "style" as const, status: "degraded" as const }] };
    expect(healthNotice(health, NAMES, ["style"])).toMatchObject({ tone: "warn", title: "Style is running without AI checks" });
    expect(healthNotice(health, NAMES, ["security"])).toBeUndefined();
    expect(healthNotice({ agents: [{ agent: "style", status: "unknown" }] }, NAMES)).toMatchObject({ title: "Can't check the agents right now" });
  });

  it("maps statuses by agent", () => {
    expect(healthByAgent({ agents: [{ agent: "style", status: "ok" }, { agent: "logic", status: "unavailable" }] })).toEqual({ style: "ok", logic: "unavailable" });
  });
});
