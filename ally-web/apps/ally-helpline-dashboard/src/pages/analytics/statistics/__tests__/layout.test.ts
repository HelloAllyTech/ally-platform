import { describe, expect, it } from "vitest";

import type { StatisticsChartEntry, StatisticsChartState, StatisticsViewConfig } from "@types";

import {
  DEFAULT_LAYOUT_CAP,
  DEFAULT_LAYOUT_FLOOR,
  buildDefaultLayout,
  groupBySection,
  insertIntoSection,
  isLegacyLayout,
  layoutKey,
  parseLayoutKey,
  resolvePins,
  resolveViewLayout,
  savedLayoutFor,
  sectionRuns,
  viewChartIds,
} from "../layout";

const chart = (
  id: string,
  state: StatisticsChartState = "available",
  filters: StatisticsChartEntry["filters"] = [],
): StatisticsChartEntry => ({
  id,
  title: id,
  question: `${id}?`,
  group: "activity",
  shape: "single_number",
  chart: "tile",
  size: "m",
  scopes: ["organisation"],
  filters,
  state,
  reason: state === "available" ? null : "because",
});

const view: StatisticsViewConfig = {
  id: "organisation",
  subject: null,
  sections: [
    { key: "learners", subject: false, charts: ["TSQ-001", "TSQ-007", "TSQ-008"] },
    { key: "courses", subject: false, charts: ["TSQ-038", "TSQ-014"] },
    { key: "skills", subject: false, charts: ["TSQ-024"] },
  ],
  defaultLayout: ["TSQ-001", "TSQ-007", "TSQ-038", "TSQ-024"],
};

describe("buildDefaultLayout", () => {
  it("is the view's default, topped up to the floor from the rest of the view", () => {
    const offered = ["TSQ-001", "TSQ-007", "TSQ-038", "TSQ-024", "TSQ-008", "TSQ-014"].map(id =>
      chart(id),
    );
    expect(buildDefaultLayout(view, offered)).toEqual([
      "TSQ-001",
      "TSQ-007",
      "TSQ-038",
      "TSQ-024",
      "TSQ-008",
    ]);
  });

  it("skips charts that are sparse or unavailable", () => {
    const offered = [
      chart("TSQ-001"),
      chart("TSQ-007", "sparse"),
      chart("TSQ-038", "unavailable"),
      chart("TSQ-024"),
      chart("TSQ-008"),
      chart("TSQ-014"),
    ];
    // Two of the four defaults remain, so it is topped up to the floor from the rest of the view.
    expect(buildDefaultLayout(view, offered)).toEqual(["TSQ-001", "TSQ-024", "TSQ-008", "TSQ-014"]);
  });

  it("tops a small organisation up to the floor, in section order, and no further", () => {
    const offered = ["TSQ-001", "TSQ-008", "TSQ-014", "TSQ-024"].map(id => chart(id));
    const layout = buildDefaultLayout(view, offered);
    expect(layout.length).toBeLessThanOrEqual(DEFAULT_LAYOUT_FLOOR);
    expect(layout.slice(0, 2)).toEqual(["TSQ-001", "TSQ-024"]);
  });

  it("never goes past the cap", () => {
    const many: StatisticsViewConfig = {
      ...view,
      defaultLayout: Array.from({ length: 14 }, (_, i) => `TSQ-${String(i + 100)}`),
      sections: [
        {
          key: "all",
          subject: false,
          charts: Array.from({ length: 14 }, (_, i) => `TSQ-${String(i + 100)}`),
        },
      ],
    };
    const offered = many.defaultLayout.map(id => chart(id));
    expect(buildDefaultLayout(many, offered)).toHaveLength(DEFAULT_LAYOUT_CAP);
  });

  it("is empty when nothing is offered", () => {
    expect(buildDefaultLayout(view, [])).toEqual([]);
  });
});

describe("resolveViewLayout", () => {
  const offered = ["TSQ-001", "TSQ-007", "TSQ-008", "TSQ-038", "TSQ-024"].map(id => chart(id));

  it("uses the default layout when nothing is saved", () => {
    expect(resolveViewLayout(undefined, view, offered)).toEqual(buildDefaultLayout(view, offered));
  });

  it("keeps an empty saved layout: the person removed everything", () => {
    expect(resolveViewLayout([], view, offered)).toEqual([]);
  });

  it("keeps the saved order", () => {
    expect(resolveViewLayout(["TSQ-024", "TSQ-001"], view, offered)).toEqual([
      "TSQ-024",
      "TSQ-001",
    ]);
  });

  it("drops charts the backend no longer offers, charts the view does not list, and repeats", () => {
    expect(
      resolveViewLayout(["TSQ-001", "TSQ-999", "TSQ-001", "TSQ-005", "TSQ-024"], view, offered),
    ).toEqual(["TSQ-001", "TSQ-024"]);
  });

  it("keeps a chart that has become unavailable, so it does not vanish silently", () => {
    const withLost = [...offered.filter(c => c.id !== "TSQ-001"), chart("TSQ-001", "unavailable")];
    expect(resolveViewLayout(["TSQ-001"], view, withLost)).toEqual(["TSQ-001"]);
  });

  it("never appends charts the person did not add", () => {
    expect(resolveViewLayout(["TSQ-001"], view, offered)).toEqual(["TSQ-001"]);
  });

  it("ignores non-string entries and a non-array value", () => {
    expect(resolveViewLayout(["TSQ-001", 5, null], view, offered)).toEqual(["TSQ-001"]);
    expect(resolveViewLayout("TSQ-001", view, offered)).toEqual(buildDefaultLayout(view, offered));
  });
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

  it("reads a plain id as a card with no filter, and rejects what is not a card key", () => {
    expect(parseLayoutKey("TSQ-020")).toEqual({ key: "TSQ-020", id: "TSQ-020", filters: {} });
    ["", "TSQ-20", "TSQ-020?course=", "TSQ-020?team=1", "TSQ-020@course:1", "x?course=1"].forEach(
      k => expect(parseLayoutKey(k), k).toBeNull(),
    );
  });

  it("keeps a saved filter the card offers and drops one it does not", () => {
    const filtered = [chart("TSQ-024", "available", [{ key: "learner", required: false }])];
    expect(resolveViewLayout([`TSQ-024?learner=4&course=${course}`], view, filtered)).toEqual([
      "TSQ-024?learner=4",
    ]);
  });
});

describe("resolvePins", () => {
  const offered = ["TSQ-001", "TSQ-002", "TSQ-009"].map(id => chart(id));
  const canPin = (id: string) => id !== "TSQ-009";

  it("is empty until something is pinned", () => {
    expect(resolvePins(undefined, offered, canPin)).toEqual([]);
  });

  it("keeps pinned charts in order, with their filters, once each", () => {
    expect(resolvePins(["TSQ-002", "TSQ-001?course=abc", "TSQ-002"], offered, canPin)).toEqual([
      "TSQ-002",
      "TSQ-001?course=abc",
    ]);
  });

  it("drops a chart that is gone, cannot be pinned, or is not a card key", () => {
    expect(resolvePins(["TSQ-999", "TSQ-009", "nope", 4], offered, canPin)).toEqual([]);
  });
});

describe("savedLayoutFor", () => {
  it("reads the layout saved for a tab", () => {
    expect(savedLayoutFor({ statistics_layouts: { course: ["TSQ-041"] } }, "course")).toEqual([
      "TSQ-041",
    ]);
  });

  it("reads the older single list as the Organisation layout, and only that", () => {
    const prefs = { statistics_dashboard: ["TSQ-001"] };
    expect(savedLayoutFor(prefs, "organisation")).toEqual(["TSQ-001"]);
    expect(savedLayoutFor(prefs, "course")).toBeUndefined();
  });

  it("prefers the new layout over the older list", () => {
    const prefs = {
      statistics_dashboard: ["TSQ-001"],
      statistics_layouts: { organisation: ["TSQ-002"] },
    };
    expect(savedLayoutFor(prefs, "organisation")).toEqual(["TSQ-002"]);
  });

  it("is undefined for a person with no preferences", () => {
    expect(savedLayoutFor(null, "organisation")).toBeUndefined();
  });
});

describe("sections", () => {
  it("lists a view's charts in section order", () => {
    expect(viewChartIds(view)).toEqual([
      "TSQ-001",
      "TSQ-007",
      "TSQ-008",
      "TSQ-038",
      "TSQ-014",
      "TSQ-024",
    ]);
  });

  it("starts a new heading wherever the section changes, so dragging never orphans one", () => {
    const items = ["TSQ-001", "TSQ-038", "TSQ-007"].map(id => parseLayoutKey(id)!);
    expect(sectionRuns(view, items).map(r => [r.section, r.items.map(i => i.id)])).toEqual([
      ["learners", ["TSQ-001"]],
      ["courses", ["TSQ-038"]],
      ["learners", ["TSQ-007"]],
    ]);
  });
});

describe("an older single-list layout", () => {
  it("is put into section order, keeping the order within a section", () => {
    expect(groupBySection(view, ["TSQ-024", "TSQ-038", "TSQ-008", "TSQ-001", "TSQ-014"])).toEqual([
      "TSQ-008",
      "TSQ-001",
      "TSQ-038",
      "TSQ-014",
      "TSQ-024",
    ]);
  });

  it("puts a chart the view does not list last, where the layout drops it", () => {
    expect(groupBySection(view, ["TSQ-999", "TSQ-001"])).toEqual(["TSQ-001", "TSQ-999"]);
  });

  it("is recognised only for Organisation, and only while nothing newer is saved", () => {
    const legacy = { statistics_dashboard: ["TSQ-001"] };
    expect(isLegacyLayout(legacy, "organisation")).toBe(true);
    expect(isLegacyLayout(legacy, "course")).toBe(false);
    expect(
      isLegacyLayout(
        { ...legacy, statistics_layouts: { organisation: ["TSQ-001"] } },
        "organisation",
      ),
    ).toBe(false);
    expect(isLegacyLayout({}, "organisation")).toBe(false);
  });
});

describe("insertIntoSection", () => {
  it("puts a chart at the end of its own section and leaves the rest as arranged", () => {
    expect(insertIntoSection(view, ["TSQ-001", "TSQ-038", "TSQ-024"], "TSQ-008")).toEqual([
      "TSQ-001",
      "TSQ-008",
      "TSQ-038",
      "TSQ-024",
    ]);
  });

  it("goes before the first chart of a later section", () => {
    expect(insertIntoSection(view, ["TSQ-001", "TSQ-038", "TSQ-024"], "TSQ-007")).toEqual([
      "TSQ-001",
      "TSQ-007",
      "TSQ-038",
      "TSQ-024",
    ]);
  });

  it("does not add a chart that is already there, or one the view does not list", () => {
    expect(insertIntoSection(view, ["TSQ-001"], "TSQ-001")).toEqual(["TSQ-001"]);
    expect(insertIntoSection(view, ["TSQ-001"], "TSQ-999")).toEqual(["TSQ-001"]);
  });
});
