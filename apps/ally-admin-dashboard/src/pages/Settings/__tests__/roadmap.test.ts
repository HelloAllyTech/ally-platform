import { describe, expect, it } from "vitest";

import type { PublicRoadmapItem } from "@api";

import { groupRoadmapItems, reorderedIds } from "../roadmap";

const item = (overrides: Partial<PublicRoadmapItem>): PublicRoadmapItem => ({
  id: "x",
  title: "Card",
  description: "Text",
  note: null,
  category: "prepare",
  stage: "idea",
  sortOrder: 0,
  isPublic: true,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  ...overrides,
});

describe("groupRoadmapItems", () => {
  it("files cards by category and stage, each cell top to bottom", () => {
    const cells = groupRoadmapItems([
      item({ id: "b", sortOrder: 1 }),
      item({ id: "a", sortOrder: 0 }),
      item({ id: "c", category: "perform", stage: "stable" }),
    ]);

    expect(cells.prepare.idea.map(i => i.id)).toEqual(["a", "b"]);
    expect(cells.perform.stable.map(i => i.id)).toEqual(["c"]);
    expect(cells.perform.idea).toEqual([]);
  });
});

describe("reorderedIds", () => {
  const cell = [item({ id: "a" }), item({ id: "b" }), item({ id: "c" })];

  it("swaps a card with its neighbour and returns the whole cell", () => {
    expect(reorderedIds(cell, "b", -1)).toEqual(["b", "a", "c"]);
    expect(reorderedIds(cell, "b", 1)).toEqual(["a", "c", "b"]);
  });

  it("returns null past either end, so no request is sent", () => {
    expect(reorderedIds(cell, "a", -1)).toBeNull();
    expect(reorderedIds(cell, "c", 1)).toBeNull();
    expect(reorderedIds(cell, "missing", 1)).toBeNull();
  });
});
