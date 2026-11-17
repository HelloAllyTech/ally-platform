import "@constants";
import { describe, expect, it } from "vitest";

import type { RoadmapItemRow, RoadmapPersonRef } from "@types";

import {
  panelTabForStage,
  personLabel,
  quietLine,
  statusLine,
  trackerModel,
  whyHereLine,
} from "../utils/copy";

const ravi: RoadmapPersonRef = { id: 1, name: "Ravi", role: "idea", relation: "author" };
const priya: RoadmapPersonRef = { id: 2, name: "Priya", role: "builder", relation: "lead" };

const row = (overrides: Partial<RoadmapItemRow>): RoadmapItemRow => ({
  code: "OPP-1",
  title: "Streak",
  shownStage: "submitted",
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
    ).toBe("Priya leads · planning not started");
    expect(
      statusLine(
        row({
          shownStage: "accepted",
          statusParts: { stage: "accepted", leadUserId: null, needsLead: true, votes: 1 },
        }),
      ),
    ).toBe("Needs a lead");
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
    expect(
      building({ waitingForPr: true, externalBuild: { byUserId: 2, at: "2026-11-10" } }),
    ).toBe("Brief sent to Claude Code by Priya · waiting for a PR");
    expect(building({ heldReason: "touches a migration" })).toBe("Held: touches a migration");
    expect(building({ releasing: true })).toBe("Merged · releasing");
  });

  it("shows a decline reason only when the server sent one", () => {
    const declined = row({
      shownStage: "declined",
      statusParts: { stage: "declined", byUserId: 9, at: null },
    });
    expect(statusLine(declined)).toBe("Declined");
    expect(
      statusLine({
        ...declined,
        declineReason: "overlaps OPP-212",
        people: [{ id: 9, name: "Sandeep", role: "owner" }],
      }),
    ).toBe("Declined by Sandeep: overlaps OPP-212");
  });

  it("falls back to the stage word for status parts it doesn't know", () => {
    expect(statusLine(row({ shownStage: "shipped", statusParts: { odd: true } }))).toBe("Shipped");
  });
});

describe("whyHereLine", () => {
  const now = new Date("2026-11-09T10:00:00Z").getTime();
  it("writes each reason", () => {
    expect(
      whyHereLine({ kind: "agentQuestion", phase: "plan", questionPreview: "which learners first?" }),
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
  it("marks steps before the current one done", () => {
    const model = trackerModel("planning");
    expect(model.kind).toBe("steps");
    if (model.kind !== "steps") return;
    expect(model.steps.map(s => s.state)).toEqual(["done", "done", "current", "todo", "todo"]);
    expect(model.steps.map(s => s.label)).toEqual([
      "Submitted",
      "Accepted",
      "Planning",
      "Building",
      "Shipped",
    ]);
  });
  it("replaces the tracker for Declined and Closed", () => {
    expect(trackerModel("declined")).toEqual({ kind: "terminal", stage: "declined", label: "Declined" });
  });
});

describe("people and quiet line", () => {
  it("labels people with their relation or role", () => {
    expect(personLabel(ravi)).toBe("Ravi (author)");
    expect(personLabel({ id: 3, name: "Ana", role: "builder" })).toBe("Ana (Builder)");
  });
  it("says who decides instead of greying out a button", () => {
    expect(quietLine({ shownStage: "planning", lead: priya })).toBe(
      "Priya leads this idea and decides what happens next.",
    );
    expect(quietLine({ shownStage: "submitted" })).toMatch(/Owner reviews/);
  });
  it("opens the side panel on the tab matching the stage", () => {
    expect(panelTabForStage("submitted")).toBe("summary");
    expect(panelTabForStage("building")).toBe("build");
    expect(panelTabForStage("shipped")).toBe("ship");
  });
});
