import { describe, expect, it } from "vitest";

import { RoadmapOpportunity, RoadmapOpportunityStage } from "@types";

import { acceptTarget, inversePatch } from "../utils/triage";

const opp = (over: Partial<RoadmapOpportunity> = {}) =>
  ({
    stage: RoadmapOpportunityStage.NEW,
    effort: null,
    ownerUserId: null,
    productGoal: "Scribe",
    plannedMonth: null,
    ...over,
  }) as RoadmapOpportunity;

describe("inversePatch", () => {
  it("restores only the fields that were patched, from the row as it was", () => {
    const row = opp({ ownerUserId: 4, effort: "m" as never });
    expect(inversePatch(row, { ownerUserId: 9 })).toEqual({ ownerUserId: 4 });
    expect(inversePatch(row, { effort: "xl" as never })).toEqual({ effort: "m" });
  });

  it("undoes an assignment back to unassigned with null, not undefined", () => {
    expect(inversePatch(opp(), { ownerUserId: 3 })).toEqual({ ownerUserId: null });
  });

  it("restores a legacy under_development stage as Prioritised", () => {
    const row = opp({ stage: RoadmapOpportunityStage.UNDER_DEVELOPMENT });
    expect(inversePatch(row, { stage: RoadmapOpportunityStage.ARCHIVED })).toEqual({
      stage: RoadmapOpportunityStage.PRIORITISED,
    });
  });
});

describe("acceptTarget", () => {
  it("accepts an Idea into Prioritised and nothing else", () => {
    expect(acceptTarget("new")).toBe("prioritised");
    expect(acceptTarget("prioritised")).toBeNull();
    expect(acceptTarget("released")).toBeNull();
    expect(acceptTarget("archived")).toBeNull();
  });
});
