import "@constants";
import React from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RoadmapItemRow, RoadmapPlanWaits } from "@types";

import { PlanWaits } from "../components/PlanWaits";
import { AuthorQuestionTag } from "../session/AuthorQuestionTag";
import { PLAN_NEXT_SIZE, todoGroups } from "../triage/todoGroups";
import { whyHereLine } from "../utils/copy";
import { whyRanksLine } from "../utils/whyRanks";

const row = (
  code: string,
  shownStage: string,
  queueRank: number | null = null,
  statusParts: Record<string, unknown> = {},
): RoadmapItemRow => ({
  id: `uuid-${code}`,
  code,
  title: code,
  shownStage: shownStage as RoadmapItemRow["shownStage"],
  statusParts,
  author: { id: 1, name: "Ravi", role: "idea" },
  votes: 0,
  queueRank,
  votedByMe: false,
  starred: false,
  unread: false,
  updatedAt: "",
  stageSince: "",
});

describe("todoGroups (idea-to-plan audit rec 9)", () => {
  it("groups To do by the Owner's next step, in a fixed order", () => {
    const groups = todoGroups([
      row("A", "accepted", 3),
      row("R", "submitted", 1),
      row("P", "planning", 2, { stage: "planning" }),
      row("C", "planning", 4, { stage: "planning", planClosed: { byUserId: 3, at: "x" } }),
    ]);
    expect(groups.map(g => [g.key, g.rows.map(r => r.code)])).toEqual([
      ["review", ["R"]],
      ["planNext", ["A"]],
      ["planning", ["P"]],
      ["planClosed", ["C"]],
      ["later", []],
    ]);
  });

  it("puts the ten best-ranked accepted ideas in Plan next and keeps the list's own order", () => {
    const accepted = Array.from({ length: 14 }, (_, i) => row(`A${i}`, "accepted", 14 - i));
    const groups = todoGroups([...accepted, row("U", "accepted", null)]);
    const next = groups.find(g => g.key === "planNext")!.rows.map(r => r.code);
    expect(next).toHaveLength(PLAN_NEXT_SIZE);
    // Ranks 1–10 are A13…A4; shown in the order the rows came.
    expect(next).toEqual(["A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11", "A12", "A13"]);
    expect(groups.find(g => g.key === "later")!.rows.map(r => r.code)).toEqual([
      "A0",
      "A1",
      "A2",
      "A3",
      "U",
    ]);
  });
});

describe("whyRanksLine", () => {
  it("reads the server's object as one line", () => {
    expect(
      whyRanksLine({
        queueRank: 4,
        compositeScore: 12,
        votes: 12,
        voters: 3,
        goalsHelped: 2,
        goalsAssessed: 3,
        starred: true,
        rating: "strong",
      }),
    ).toBe("#4 in To do · 12 votes from 3 people · helps 2 of 3 goals · starred by an Owner");
  });

  it("says nothing it has no facts for, and keeps plain text", () => {
    expect(whyRanksLine({ queueRank: null, votes: 0, voters: 0, goalsAssessed: 0 })).toBe("");
    expect(whyRanksLine("Top of the list")).toBe("Top of the list");
    expect(whyRanksLine(null)).toBe("");
  });
});

describe("why-here lines for the new notices", () => {
  it("words a question for the author, plan ready, an answer and what moved", () => {
    expect(
      whyHereLine({
        kind: "agentQuestion",
        phase: "plan",
        questionPreview: "Who hits it?",
        forAuthor: true,
      }),
    ).toBe("Plan agent asks you: Who hits it?");
    expect(whyHereLine({ kind: "notice", notice: "planReady", since: "" })).toBe(
      "The plan is ready to read",
    );
    expect(
      whyHereLine({
        kind: "notice",
        notice: "questionAnswered",
        since: "",
        by: { id: 1, name: "Ravi", role: "idea" },
      }),
    ).toBe("Ravi answered the agent's question");
    expect(whyHereLine({ kind: "notice", notice: "planOffered", since: "" })).toBe(
      "Expand it into a plan yourself, or ask the product owner",
    );
    expect(
      whyHereLine({
        kind: "notice",
        notice: "planHandedOver",
        since: "",
        by: { id: 1, name: "Ravi", role: "idea" },
      }),
    ).toBe("Ravi handed you the plan interview");
    expect(whyHereLine({ kind: "notice", notice: "planHandedOver", since: "" })).toBe(
      "A plan interview is waiting for an Owner",
    );
    expect(whyHereLine({ kind: "progress", notice: "planClosed" })).toBe("Plan closed");
    expect(whyHereLine({ kind: "progress" })).toBe("Moved since you last looked");
  });
});

describe("AuthorQuestionTag", () => {
  it("names the author on their question only", () => {
    const item = { author: { id: 1, name: "Ravi", role: "idea" as const } };
    const { rerender } = render(<AuthorQuestionTag question={{ forAuthor: true }} item={item} />);
    expect(screen.getByText("For Ravi, who wrote the idea")).toBeTruthy();
    rerender(<AuthorQuestionTag question={{}} item={item} />);
    expect(screen.queryByText(/who wrote the idea/)).toBeNull();
  });
});

describe("PlanWaits", () => {
  const waits: RoadmapPlanWaits = {
    acceptedUnplannedNow: 187,
    planningNow: 2,
    submittedToPlanning: { n: 3, medianMs: 2 * 86_400_000, p75Ms: 3 * 86_400_000 },
    planningToClosed: { n: 0, medianMs: null, p75Ms: null },
    authorLooked: { closed: 4, opened: 3 },
  };

  it("shows the waits after review, and nothing from an older server", () => {
    const { container, rerender } = render(<PlanWaits waits={waits} />);
    expect(screen.getByText("Waits after review")).toBeTruthy();
    expect(screen.getByText("187")).toBeTruthy();
    expect(screen.getByText("3 of 4")).toBeTruthy();
    rerender(<PlanWaits />);
    expect(container.textContent).toBe("");
  });
});
