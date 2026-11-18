import { describe, expect, it } from "vitest";

import { PmAgentIdeaRow } from "@types";

import { passageProblem, pinnedRuleButtons } from "../pm/pinnedRuleButtons";

/** Notes "Pinned rules: approval flow": the button set per kind of pinned-rule item. */
const idea = (over: {
  firstVersion?: boolean;
  mine?: boolean;
  status?: PmAgentIdeaRow["status"];
  can?: PmAgentIdeaRow["can"];
}) =>
  ({
    id: "i",
    status: over.status ?? "proposed",
    title: "t",
    change: {
      ideaKind: "pinned_rule",
      promptCode: "debrief_quality_rubric",
      find: over.firstVersion ? null : "a",
      replace: over.firstVersion ? null : "b",
      settingKey: null,
      settingValue: null,
      firstVersion: over.firstVersion,
    },
    evidence: {},
    createdAt: "2026-11-12T00:00:00Z",
    releaseVersion: null,
    releaseStatus: null,
    can: over.can,
    pinnedRule: over.firstVersion
      ? undefined
      : {
          name: "Rubric",
          firstVersion: false,
          mine: !!over.mine,
          proposedBy: 1,
          liveVersion: 1,
          liveText: "a",
          segments: null,
          stale: false,
          otherOpen: 0,
          approvedNote: null,
        },
  }) as unknown as PmAgentIdeaRow;

const ADVISOR = { approvePinnedRule: true };
const TEAM = { approvePinnedRule: false };

describe("pinnedRuleButtons", () => {
  it("first version: Approve · Ask for a change, never Reject", () => {
    expect(pinnedRuleButtons(idea({ firstVersion: true }), ADVISOR)).toEqual(["approve", "ask"]);
  });

  it("the viewer's own proposal: Approve · Withdraw", () => {
    expect(pinnedRuleButtons(idea({ mine: true }), ADVISOR)).toEqual(["approve", "withdraw"]);
  });

  it("from the PM agent or another person: Approve · Reject · Ask for a change", () => {
    expect(pinnedRuleButtons(idea({}), ADVISOR)).toEqual(["approve", "reject", "ask"]);
  });

  it("ally-be's can wins, and a first version gets no Reject whatever it says", () => {
    const can = {
      approve: true,
      reject: true,
      tryIt: false,
      askQuestion: false,
      startStep: false,
      withdraw: false,
      askForChange: true,
    };
    expect(pinnedRuleButtons(idea({ firstVersion: true, can }), TEAM)).toEqual(["approve", "ask"]);
  });

  it("nothing for the Ally team alone, or once it is decided", () => {
    expect(pinnedRuleButtons(idea({}), TEAM)).toEqual([]);
    expect(pinnedRuleButtons(idea({ status: "approved" }), ADVISOR)).toEqual([]);
  });
});

describe("passageProblem", () => {
  it("names a missing, repeated or empty passage", () => {
    expect(passageProblem("one two one", "one")).toBe("notUnique");
    expect(passageProblem("one two", "three")).toBe("notFound");
    expect(passageProblem("one two", " ")).toBe("empty");
    expect(passageProblem("one two", "two")).toBeNull();
  });
});
