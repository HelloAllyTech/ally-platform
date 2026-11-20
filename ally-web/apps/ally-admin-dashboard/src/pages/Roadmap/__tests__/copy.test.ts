import "@constants";
import { describe, expect, it } from "vitest";

import type { RoadmapItemRow, RoadmapPersonRef } from "@types";

import {
  panelTabForStage,
  personLabel,
  quietLine,
  simpleStageOfShown,
  statusLine,
  timelineAnchors,
  timelineLabel,
  trackerModel,
  whyHereLine,
} from "../utils/copy";

const ravi: RoadmapPersonRef = { id: 1, name: "Ravi", role: "idea", relation: "author" };
const priya: RoadmapPersonRef = { id: 2, name: "Priya", role: "builder", relation: "lead" };

const row = (overrides: Partial<RoadmapItemRow>): RoadmapItemRow => ({
  id: "uuid-1",
  code: "OPP-1",
  title: "Streak",
  shownStage: "submitted",
  stage: "backlog",
  statusParts: { stage: "submitted", since: "2026-11-03T10:00:00Z", votes: 6 },
  author: ravi,
  votes: 6,
  votedByMe: false,
  starred: false,
  unread: false,
  updatedAt: "2026-11-03T10:00:00Z",
  stageSince: "2026-11-03T10:00:00Z",
  ...overrides,
});

describe("statusLine", () => {
  it("says how long a submitted idea has waited, with its votes", () => {
    expect(statusLine(row({}))).toBe("Waiting for review since 3 Nov · ▲6");
  });

  it("names the lead by name, never by id", () => {
    expect(
      statusLine(
        row({
          shownStage: "accepted",
          statusParts: { stage: "accepted", leadUserId: 2, needsLead: false, votes: 1 },
          lead: priya,
        }),
      ),
    ).toBe("Priya builds it · planning not started");
    expect(
      statusLine(
        row({
          shownStage: "accepted",
          statusParts: { stage: "accepted", leadUserId: null, needsLead: true, votes: 1 },
        }),
      ),
    ).toBe("Needs planning");
  });

  it("covers planning's three steps", () => {
    const planning = (step: "prd" | "design" | "ready", designAwaitingApproval = false) =>
      statusLine(
        row({
          shownStage: "planning",
          statusParts: {
            stage: "planning",
            step,
            leadUserId: 2,
            prdPercent: 70,
            openQuestions: 2,
            designAwaitingApproval,
          },
        }),
      );
    expect(planning("prd")).toBe("PRD 70% · 2 questions");
    expect(planning("design", true)).toBe("Design waiting for approval");
    expect(planning("ready")).toBe("Ready to build");
    expect(
      statusLine({
        ...row({ shownStage: "planning" }),
        people: [priya],
        statusParts: {
          stage: "planning",
          step: "ready",
          leadUserId: 2,
          prdPercent: 100,
          openQuestions: 0,
          designAwaitingApproval: false,
          externalBuild: { byUserId: 2, at: "2026-11-10" },
        },
      }),
    ).toBe("Brief sent to Claude Code by Priya · waiting for a PR");
  });

  it("says a brief was sent until a PR exists, and names a held release", () => {
    const building = (overrides: Record<string, unknown>) =>
      statusLine({
        ...row({ shownStage: "building" }),
        people: [ravi, priya],
        statusParts: {
          stage: "building",
          where: "here",
          leadUserId: 2,
          externalBuild: null,
          repos: ["ally-be", "admin"],
          openPrs: [{ number: 412, ci: "passing" }],
          mergedPrs: 0,
          waitingForPr: false,
          releasing: false,
          heldReason: null,
          ...overrides,
        },
      });
    expect(building({})).toBe("Building ally-be + admin · PR #412 CI passing");
    expect(building({ waitingForPr: true, externalBuild: { byUserId: 2, at: "2026-11-10" } })).toBe(
      "Brief sent to Claude Code by Priya · waiting for a PR",
    );
    expect(building({ heldReason: "touches a migration" })).toBe("Held: touches a migration");
    expect(building({ releasing: true })).toBe("Merged · releasing");
  });

  it("shows a decline reason only when the server sent one", () => {
    const declined = row({
      shownStage: "declined",
      statusParts: { stage: "declined", byUserId: 9, at: null },
    });
    expect(statusLine(declined)).toBe("Not building");
    expect(
      statusLine({
        ...declined,
        declineReason: "overlaps OPP-212",
        people: [{ id: 9, name: "Sandeep", role: "owner" }],
      }),
    ).toBe("Declined by Sandeep: overlaps OPP-212");
  });

  it("falls back to the stage word for status parts it doesn't know", () => {
    expect(statusLine(row({ shownStage: "shipped", statusParts: { odd: true } }))).toBe("Released");
  });
});

describe("whyHereLine", () => {
  const now = new Date("2026-11-09T10:00:00Z").getTime();
  it("writes each reason", () => {
    expect(
      whyHereLine({
        kind: "agentQuestion",
        phase: "plan",
        questionPreview: "which learners first?",
      }),
    ).toBe("Plan agent asks: which learners first?");
    expect(whyHereLine({ kind: "mention", by: { id: 3, name: "Ana", role: "builder" } })).toBe(
      "Ana asked you",
    );
    expect(whyHereLine({ kind: "awaitingReview", since: "2026-11-03T10:00:00Z" }, now)).toBe(
      "Waiting 6 days for review",
    );
    expect(whyHereLine({ kind: "reassign", idleDays: 14 })).toBe("Lead idle 14 days · Reassign?");
    expect(whyHereLine({ kind: "decision", decision: "merge" })).toBe("Ready for you to merge");
    expect(whyHereLine(undefined)).toBe("");
  });
});

describe("trackerModel", () => {
  it("has three steps in the lifecycle's words: To do, Building, Released", () => {
    const model = trackerModel("being_built");
    expect(model.kind).toBe("steps");
    if (model.kind !== "steps") return;
    expect(model.steps.map(s => s.state)).toEqual(["done", "current", "todo"]);
    expect(model.steps.map(s => s.label)).toEqual(["To do", "Building", "Released"]);
  });
  it("reads the finer stages as the stage they fall in: To do until a builder is assigned", () => {
    const building = trackerModel("building");
    expect(building.kind === "steps" && building.currentIndex).toBe(1);
    for (const shown of ["submitted", "accepted", "planning"] as const) {
      const model = trackerModel(shown);
      expect(model.kind === "steps" && model.currentIndex).toBe(0);
    }
    expect(simpleStageOfShown("planning", true)).toBe("being_built");
    expect(simpleStageOfShown("accepted", true)).toBe("being_built");
    expect(simpleStageOfShown("closed")).toBe("declined");
  });
  it("replaces the tracker for Not building, Closed and Draft", () => {
    expect(trackerModel("declined")).toEqual({
      kind: "terminal",
      stage: "declined",
      label: "Not building",
    });
    expect(trackerModel("closed")).toMatchObject({ kind: "terminal", stage: "declined" });
    expect(trackerModel("draft")).toMatchObject({ kind: "terminal", stage: "draft" });
  });
});

describe("people and quiet line", () => {
  it("labels people with their relation or role", () => {
    expect(personLabel(ravi)).toBe("Ravi (submitter)");
    expect(personLabel({ id: 3, name: "Ana", role: "builder" })).toBe("Ana (Builder)");
  });
  it("says who decides instead of greying out a button", () => {
    expect(quietLine({ shownStage: "planning", lead: priya })).toBe(
      "Priya builds this idea and marks it released when it ships.",
    );
    expect(quietLine({ shownStage: "submitted" })).toMatch(/Owner expands/);
    expect(quietLine({ shownStage: "planning" })).toMatch(/An Owner is planning/);
    expect(
      quietLine({
        shownStage: "planning",
        statusParts: {
          stage: "planning",
          step: "prd",
          leadUserId: null,
          prdPercent: 40,
          openQuestions: 0,
          designAwaitingApproval: false,
          planClosed: { byUserId: 1, at: "2026-11-18T10:00:00Z" },
        },
      }),
    ).toMatch(/assigns a builder next/);
  });
  it("opens the side panel on the tab matching the stage", () => {
    expect(panelTabForStage("submitted")).toBe("summary");
    expect(panelTabForStage("building")).toBe("build");
    expect(panelTabForStage("shipped")).toBe("ship");
  });
});

describe("lifecycle 2026-11-18: status line and timeline", () => {
  const planning = (over: Record<string, unknown>) =>
    row({
      shownStage: "planning",
      statusParts: {
        stage: "planning",
        step: "prd",
        leadUserId: null,
        prdPercent: 40,
        openQuestions: 0,
        designAwaitingApproval: false,
        ...over,
      },
    });

  it("says an Owner is planning it, then that it needs a builder once the plan is closed", () => {
    expect(statusLine(planning({}))).toBe("Being planned · PRD 40%");
    expect(statusLine(planning({ planClosed: { byUserId: 1, at: "x" } }))).toBe(
      "Plan closed · needs a builder",
    );
  });

  it("names the builder and how it is built once one is assigned", () => {
    expect(statusLine({ ...planning({ leadUserId: 2, buildMode: "outside" }), lead: priya })).toBe(
      "Priya builds it · Outside Builder · PRD 40%",
    );
  });

  it("prompts, never claims, Released when the work is live", () => {
    expect(
      statusLine(
        row({
          shownStage: "building",
          statusParts: {
            stage: "building",
            where: "here",
            leadUserId: 2,
            externalBuild: null,
            repos: [],
            openPrs: [],
            mergedPrs: 1,
            waitingForPr: false,
            releasing: false,
            heldReason: null,
            workLive: true,
          },
        }),
      ),
    ).toBe("Live in production · waiting to be marked released");
  });

  it("words every milestone, and skips a kind it doesn't know", () => {
    const owner = { id: 1, name: "Sandeep", role: "owner" as const };
    expect(
      timelineLabel({
        at: "x",
        kind: "lead_assigned",
        actor: owner,
        detail: { from: null, to: priya },
      }),
    ).toBe("Sandeep assigned Priya to build it");
    expect(
      timelineLabel({
        at: "x",
        kind: "lead_assigned",
        actor: owner,
        detail: { from: ravi, to: priya },
      }),
    ).toBe("Sandeep handed it from Ravi to Priya");
    expect(timelineLabel({ at: "x", kind: "plan_closed", actor: owner })).toBe(
      "Sandeep closed the plan",
    );
    expect(
      timelineLabel({
        at: "x",
        kind: "build_mode_set",
        actor: priya,
        detail: { from: null, to: "builder_agent" },
      }),
    ).toBe("Priya: built with Builder agent");
    expect(timelineLabel({ at: "x", kind: "marked_released", actor: priya })).toBe(
      "Priya marked it released",
    );
    expect(timelineLabel({ at: "x", kind: "unheard_of" as never, actor: priya })).toBeNull();
  });

  it("places each milestone before the first message at or after it, the rest at the end", () => {
    const feed = [{ id: "m1" }, { id: "m2" }];
    const at: Record<string, string> = {
      m1: "2026-11-02T00:00:00Z",
      m2: "2026-11-05T00:00:00Z",
    };
    const anchors = timelineAnchors(
      [
        { at: "2026-11-01T00:00:00Z", kind: "submitted", actor: null },
        { at: "2026-11-03T00:00:00Z", kind: "plan_closed", actor: null },
        { at: "2026-11-09T00:00:00Z", kind: "marked_released", actor: null },
      ],
      feed,
      id => at[id],
    );
    expect(anchors.get("m1")?.map(e => e.kind)).toEqual(["submitted"]);
    expect(anchors.get("m2")?.map(e => e.kind)).toEqual(["plan_closed"]);
    expect(anchors.get(null)?.map(e => e.kind)).toEqual(["marked_released"]);
  });
});
