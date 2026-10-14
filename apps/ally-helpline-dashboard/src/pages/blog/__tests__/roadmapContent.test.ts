import { describe, expect, it } from "vitest";

import type { RoadmapCard } from "@api";

import { formatRoadmapMonth, groupIntoGrid, stageLevel } from "../roadmapContent";

const card = (overrides: Partial<RoadmapCard>): RoadmapCard => ({
  id: "c1",
  title: "Learner App",
  description: "A vertical, voice-first LMS.",
  note: null,
  category: "prepare",
  stage: "beta",
  sortOrder: 0,
  ...overrides,
});

describe("groupIntoGrid", () => {
  it("places each card in its category × stage cell, top to bottom by sortOrder", () => {
    const grid = groupIntoGrid([
      card({ id: "b", stage: "idea", sortOrder: 1 }),
      card({ id: "a", stage: "idea", sortOrder: 0 }),
      card({ id: "c", category: "perform", stage: "lab" }),
    ]);

    expect(grid.prepare.idea.map(c => c.id)).toEqual(["a", "b"]);
    expect(grid.perform.lab.map(c => c.id)).toEqual(["c"]);
    expect(grid.prepare.stable).toEqual([]);
  });

  it("drops a card whose stage this build does not know rather than guessing a cell", () => {
    const grid = groupIntoGrid([card({ stage: "sunset" as RoadmapCard["stage"] })]);

    expect(Object.values(grid.prepare).flat()).toEqual([]);
  });
});

describe("stageLevel", () => {
  it("fills one dot for an idea and all five for a stable product", () => {
    expect(stageLevel("idea")).toBe(1);
    expect(stageLevel("released")).toBe(4);
    expect(stageLevel("stable")).toBe(5);
  });
});

describe("formatRoadmapMonth", () => {
  it("shows the month and year the roadmap last changed", () => {
    expect(formatRoadmapMonth("2026-10-09T12:00:00Z")).toBe("October 2026");
  });
});
