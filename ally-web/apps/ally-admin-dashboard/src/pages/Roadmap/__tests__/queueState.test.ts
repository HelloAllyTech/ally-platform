import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIEWS,
  DEFAULT_VIEW_IDS,
  activeFilterCount,
  decodeQueueState,
  defaultSortFor,
  effectiveFilters,
  encodeQueueState,
  filterChips,
  filtersToParams,
  orderViews,
  paramsToFilters,
  queueSignature,
  readView,
  removeChip,
  savedViewPayload,
  stateFromSavedView,
  toItemsQuery,
} from "../utils/queueState";

describe("the five default views", () => {
  it("are All, To do, Building, Released and Not building, in that order", () => {
    expect(DEFAULT_VIEW_IDS).toEqual(["all", "todo", "building", "released", "declined"]);
  });

  it("split every idea into exactly one stage view, and All has no filter", () => {
    expect(DEFAULT_VIEWS.all.filters).toEqual({});
    expect(DEFAULT_VIEWS.todo.filters).toEqual({ stage: ["backlog"] });
    expect(DEFAULT_VIEWS.building.filters).toEqual({ stage: ["being_built"] });
    expect(DEFAULT_VIEWS.released.filters).toEqual({ stage: ["shipped"] });
    expect(DEFAULT_VIEWS.declined.filters).toEqual({ stage: ["declined"] });
  });

  it("each open on the sort that fits it", () => {
    expect(DEFAULT_VIEWS.all.sort).toBe("rank");
    expect(DEFAULT_VIEWS.todo.sort).toBe("rank");
    expect(DEFAULT_VIEWS.building.sort).toBe("activity");
    expect(DEFAULT_VIEWS.released.sort).toBe("stageNewest");
    expect(DEFAULT_VIEWS.declined.sort).toBe("stageNewest");
    expect(defaultSortFor("saved")).toBe("rank");
  });

  it("put the view's own filters under the person's, so a stage can't be filtered away", () => {
    expect(
      effectiveFilters({ view: "todo", filters: { goal: ["g1"], stage: ["shipped"] } }),
    ).toEqual({
      goal: ["g1"],
      stage: ["backlog"],
    });
    expect(effectiveFilters({ view: "all", filters: { stage: ["shipped"] } })).toEqual({
      stage: ["shipped"],
    });
  });
});

describe("tab order", () => {
  it("applies a saved order to default and saved tabs, drops gone ones and appends new ones", () => {
    const tabs = ["all", "todo", "building", "released", "declined", "my-view"];
    expect(orderViews(tabs, ["my-view", "declined", "all"])).toEqual([
      "my-view",
      "declined",
      "all",
      "todo",
      "building",
      "released",
    ]);
    // A deleted view's id in the saved order is dropped; duplicates and junk are ignored.
    expect(orderViews(["all", "todo"], ["gone", "todo", "todo", "nope"])).toEqual(["todo", "all"]);
    expect(orderViews(tabs, undefined)).toEqual(tabs);
  });
});

describe("filter encoding", () => {
  it("uses the contract's params: lists comma-joined, flags 1, sorted and deduped", () => {
    expect(
      filtersToParams({
        stage: ["planning", "building", "planning"],
        starred: true,
        votedByMe: false,
        month: "2026-12",
        q: "  hindi ",
      }),
    ).toEqual({ q: "hindi", stage: "building,planning", starred: "1", month: "2026-12" });
  });

  it("round-trips through the URL", () => {
    const filters = { author: ["4", "12"], openQuestion: true, review: ["pending"] };
    const params = new URLSearchParams(filtersToParams(filters));
    expect(paramsToFilters(params)).toEqual({
      author: ["12", "4"],
      openQuestion: true,
      review: ["pending"],
    });
  });

  it("drops a malformed month instead of sending it", () => {
    expect(filtersToParams({ month: "December" })).toEqual({});
  });

  it("counts and chips each value, and removes one chip at a time", () => {
    const filters = { stage: ["planning", "building"], starred: true };
    expect(activeFilterCount(filters)).toBe(3);
    const chips = filterChips(filters);
    expect(chips).toEqual([
      { key: "stage", value: "building" },
      { key: "stage", value: "planning" },
      { key: "starred" },
    ]);
    expect(removeChip(filters, chips[0])).toEqual({ stage: ["planning"], starred: true });
    expect(removeChip(filters, chips[2])).toEqual({ stage: ["building", "planning"] });
  });
});

describe("URL state", () => {
  it("opens on All with nothing in the URL", () => {
    expect(decodeQueueState(new URLSearchParams())).toEqual({
      view: "all",
      filters: {},
    });
  });

  it("opens on each default view by its id, and remembers the last one", () => {
    for (const id of DEFAULT_VIEW_IDS) {
      expect(decodeQueueState(new URLSearchParams(`view=${id}`)).view).toBe(id);
    }
    expect(decodeQueueState(new URLSearchParams(), { view: "building" }).view).toBe("building");
    expect(decodeQueueState(new URLSearchParams("view=released"), { view: "building" }).view).toBe(
      "released",
    );
  });

  it("reads the old views as the view and filters they fall under now", () => {
    expect(readView("to-triage")).toEqual({ view: "todo", filters: {} });
    expect(readView("leading")).toEqual({ view: "all", filters: { ledByMe: true } });
    expect(readView("for-you")).toEqual({ view: "all", filters: { needsYou: true } });
    expect(readView("nonsense")).toBeNull();
    const state = decodeQueueState(new URLSearchParams("view=leading&goal=g1"));
    expect(state.view).toBe("all");
    expect(state.filters).toEqual({ ledByMe: true, goal: ["g1"] });
  });

  it("round-trips view, filters, sort, saved view and the open idea", () => {
    const state = {
      view: "all" as const,
      filters: { stage: ["shipped"], votedByMe: true },
      sort: "votes" as const,
      savedViewId: "v1",
      open: "OPP-388",
    };
    const encoded = encodeQueueState(state);
    expect(encoded.toString()).toBe(
      "view=all&stage=shipped&votedByMe=1&sort=votes&sv=v1&open=OPP-388",
    );
    expect(decodeQueueState(encoded)).toEqual(state);
  });

  it("omits the view's default sort from the URL", () => {
    expect(encodeQueueState({ view: "all", filters: {}, sort: "rank" }).toString()).toBe(
      "view=all",
    );
    expect(
      encodeQueueState({
        view: "released",
        filters: {},
        sort: "stageNewest",
      }).toString(),
    ).toBe("view=released");
  });
});

describe("toItemsQuery", () => {
  it("is always the one list: the view's own filters go in as filters", () => {
    expect(toItemsQuery({ view: "todo", filters: {} })).toEqual({
      view: "all",
      stage: "backlog",
      sort: "rank",
    });
    expect(toItemsQuery({ view: "released", filters: {} })).toMatchObject({
      view: "all",
      stage: "shipped",
      sort: "stageNewest",
    });
  });

  it("sends the filters, the sort in force and the cursor", () => {
    expect(toItemsQuery({ view: "all", filters: { goal: ["g1"], needsYou: true } }, "c2")).toEqual({
      view: "all",
      goal: "g1",
      needsYou: "1",
      sort: "rank",
      cursor: "c2",
    });
    expect(toItemsQuery({ view: "building", filters: {}, sort: "votes" }).sort).toBe("votes");
  });
});

describe("saved views", () => {
  it("stores the contract's params plus view and sort, and reads them back as its own list", () => {
    const payload = savedViewPayload({
      view: "all",
      filters: { stage: ["shipped"] },
      sort: "newest",
    });
    expect(payload).toEqual({ view: "all", stage: "shipped", sort: "newest" });
    expect(stateFromSavedView(payload, "v9")).toEqual({
      view: "all",
      filters: { stage: ["shipped"] },
      sort: "newest",
      savedViewId: "v9",
      open: undefined,
    });
  });

  it("saved from a default view, keeps that view's own filters in the saved view", () => {
    const payload = savedViewPayload({
      view: "todo",
      filters: { goal: ["g1"] },
    });
    expect(payload).toEqual({ view: "all", stage: "backlog", goal: "g1" });
  });

  it("reads an old saved view's For you / Leading / To triage as the filters they mean", () => {
    expect(stateFromSavedView({ view: "to-triage" }, "v1").filters).toEqual({
      stage: ["backlog"],
    });
    expect(stateFromSavedView({ view: "leading" }, "v2").filters).toEqual({
      ledByMe: true,
    });
  });

  it("compares filters regardless of order", () => {
    expect(queueSignature({ stage: ["a", "b"] }, "rank")).toBe(
      queueSignature({ stage: ["b", "a"] }, "rank"),
    );
    expect(queueSignature({ stage: ["a"] }, "rank")).not.toBe(
      queueSignature({ stage: ["a"] }, "votes"),
    );
  });
});
