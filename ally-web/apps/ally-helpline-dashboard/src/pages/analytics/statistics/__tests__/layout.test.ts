import { describe, expect, it } from "vitest";

import type { StatisticsChartEntry, StatisticsChartState } from "@types";

import {
  DEFAULT_LAYOUT_CAP,
  DEFAULT_LAYOUT_ORDER,
  buildDefaultLayout,
  layoutKey,
  parseLayoutKey,
  resolveDashboardLayout,
} from "../layout";

const chart = (id: string, state: StatisticsChartState = "available"): StatisticsChartEntry => ({
  id,
  title: id,
  question: `${id}?`,
  group: "activity",
  shape: "single_number",
  chart: "tile",
  size: "m",
  scopes: ["organisation"],
  filters: [],
  state,
  reason: state === "available" ? null : "because",
});

describe("buildDefaultLayout", () => {
  it("returns only charts the backend offers, in the design's priority order", () => {
    const offered = [chart("TSQ-013"), chart("TSQ-001"), chart("TSQ-009"), chart("TSQ-002")];
    expect(buildDefaultLayout(offered)).toEqual(["TSQ-001", "TSQ-009", "TSQ-002", "TSQ-013"]);
  });

  it("skips charts that are sparse or unavailable", () => {
    const offered = [
      chart("TSQ-001"),
      chart("TSQ-002", "sparse"),
      chart("TSQ-013", "unavailable"),
      chart("TSQ-009"),
    ];
    expect(buildDefaultLayout(offered)).toEqual(["TSQ-001", "TSQ-009"]);
  });

  it("gives a small organisation just the charts that need no sample", () => {
    const offered = [
      chart("TSQ-001"),
      chart("TSQ-009"),
      chart("TSQ-002", "unavailable"),
      chart("TSQ-013", "unavailable"),
    ];
    expect(buildDefaultLayout(offered)).toEqual(["TSQ-001", "TSQ-009"]);
  });

  it("never goes past the cap", () => {
    const offered = DEFAULT_LAYOUT_ORDER.map(id => chart(id));
    expect(buildDefaultLayout(offered)).toHaveLength(DEFAULT_LAYOUT_CAP);
    expect(buildDefaultLayout(offered)).toEqual(DEFAULT_LAYOUT_ORDER.slice(0, DEFAULT_LAYOUT_CAP));
  });

  it("is empty when nothing is offered", () => {
    expect(buildDefaultLayout([])).toEqual([]);
  });
});

describe("resolveDashboardLayout", () => {
  const offered = [
    chart("TSQ-001"),
    chart("TSQ-002"),
    chart("TSQ-003"),
    chart("TSQ-013", "unavailable"),
  ];

  it("uses the default layout when nothing is saved", () => {
    expect(resolveDashboardLayout(undefined, offered)).toEqual(buildDefaultLayout(offered));
    expect(resolveDashboardLayout(null, offered)).toEqual(buildDefaultLayout(offered));
  });

  it("keeps an empty saved layout: the admin removed everything", () => {
    expect(resolveDashboardLayout([], offered)).toEqual([]);
  });

  it("keeps the saved order", () => {
    expect(resolveDashboardLayout(["TSQ-003", "TSQ-001"], offered)).toEqual(["TSQ-003", "TSQ-001"]);
  });

  it("drops ids the backend no longer offers and duplicates", () => {
    expect(resolveDashboardLayout(["TSQ-001", "TSQ-777", "TSQ-001", "TSQ-002"], offered)).toEqual([
      "TSQ-001",
      "TSQ-002",
    ]);
  });

  it("keeps a chart that has become unavailable, so it does not vanish silently", () => {
    expect(resolveDashboardLayout(["TSQ-013", "TSQ-001"], offered)).toEqual(["TSQ-013", "TSQ-001"]);
  });

  it("never appends charts the admin did not add", () => {
    expect(resolveDashboardLayout(["TSQ-001"], offered)).toEqual(["TSQ-001"]);
  });

  it("ignores non-string entries and a non-array value", () => {
    expect(resolveDashboardLayout(["TSQ-001", 5, null], offered)).toEqual(["TSQ-001"]);
    expect(resolveDashboardLayout("TSQ-001", offered)).toEqual(buildDefaultLayout(offered));
  });
});

const filtered = (id: string, filters: StatisticsChartEntry["filters"]): StatisticsChartEntry => ({
  ...chart(id, "available"),
  filters,
});

describe("a card's filters are saved with it", () => {
  const course = "8b3f2f0e-1c0a-4d6e-9a53-3d1c0d2f4a11";

  it("round-trips a card with one or two filters", () => {
    expect(layoutKey("TSQ-020", { course })).toBe(`TSQ-020?course=${course}`);
    const two = layoutKey("TSQ-020", { course, simulation: "7" });
    expect(two).toBe(`TSQ-020?course=${course}&simulation=7`);
    expect(parseLayoutKey(two)).toEqual({
      key: two,
      id: "TSQ-020",
      filters: { course, simulation: "7" },
    });
  });

  it("reads a plain id as a card with no filter", () => {
    expect(parseLayoutKey("TSQ-020")).toEqual({ key: "TSQ-020", id: "TSQ-020", filters: {} });
    expect(layoutKey("TSQ-020", {})).toBe("TSQ-020");
  });

  it("rejects strings that are not a card key", () => {
    ["", "TSQ-20", "TSQ-020?course=", "TSQ-020?team=1", "TSQ-020@course:1", "x?course=1"].forEach(
      k => expect(parseLayoutKey(k), k).toBeNull(),
    );
  });

  it("keeps a saved filter the card offers and drops one it does not", () => {
    const charts = [filtered("TSQ-020", [{ key: "course", required: false }])];
    const saved = [`TSQ-020?course=${course}&learner=4`];
    expect(resolveDashboardLayout(saved, charts)).toEqual([`TSQ-020?course=${course}`]);
  });

  it("keeps a card whose filter was retired, without the filter", () => {
    const charts = [filtered("TSQ-020", [])];
    expect(resolveDashboardLayout([`TSQ-020?course=${course}`], charts)).toEqual(["TSQ-020"]);
  });

  it("shows a chart once, the first time it is saved", () => {
    const charts = [filtered("TSQ-020", [{ key: "course", required: false }])];
    expect(resolveDashboardLayout(["TSQ-020", `TSQ-020?course=${course}`], charts)).toEqual([
      "TSQ-020",
    ]);
  });
});
