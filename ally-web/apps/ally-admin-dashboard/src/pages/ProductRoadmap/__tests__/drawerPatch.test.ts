import { describe, expect, it } from "vitest";

import { RoadmapOpportunity, RoadmapOpportunityStage } from "@types";

import { diffDraft, draftFromOpportunity, isDraftDirty } from "../utils/drawerPatch";

const opp = (over: Partial<RoadmapOpportunity> = {}) =>
  ({
    description: "Voice notes",
    stage: RoadmapOpportunityStage.NEW,
    productGoal: "Scribe",
    ownerUserId: null,
    prd: null,
    claudePrompt: null,
    plannedMonth: null,
    effort: null,
    referenceImages: [],
    ...over,
  }) as RoadmapOpportunity;

describe("diffDraft", () => {
  it("sends nothing when nothing changed", () => {
    const base = draftFromOpportunity(opp());
    expect(diffDraft({ ...base }, base)).toEqual({});
    expect(isDraftDirty({ ...base }, base)).toBe(false);
  });

  it("sends only the edited field, so a stale stage or owner is never resubmitted", () => {
    // Another admin moved the stage and set an owner after this drawer loaded. The drawer's draft
    // still holds the old values; editing the description must not carry them back.
    const base = draftFromOpportunity(opp());
    const draft = { ...base, description: "Voice notes for scribes" };
    expect(diffDraft(draft, base)).toEqual({ description: "Voice notes for scribes" });
  });

  it("turns the empty-string sentinels into null", () => {
    const base = draftFromOpportunity(
      opp({ ownerUserId: 7, plannedMonth: "2026-12", effort: "m" as never }),
    );
    expect(diffDraft({ ...base, ownerUserId: "", plannedMonth: "", effort: "" }, base)).toEqual({
      ownerUserId: null,
      plannedMonth: null,
      effort: null,
    });
  });

  it("converts the owner id back to a number", () => {
    const base = draftFromOpportunity(opp());
    expect(diffDraft({ ...base, ownerUserId: "12" }, base)).toEqual({ ownerUserId: 12 });
  });

  it("does not call trailing whitespace an edit", () => {
    const base = draftFromOpportunity(opp());
    expect(diffDraft({ ...base, description: "Voice notes  " }, base)).toEqual({});
  });
});
