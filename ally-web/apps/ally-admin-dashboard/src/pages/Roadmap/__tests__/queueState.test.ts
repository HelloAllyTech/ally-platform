import { describe, expect, it } from "vitest";

import {
  activeFilterCount,
  canUseBoard,
  decodeQueueState,
  defaultSortFor,
  isSectionedView,
  encodeQueueState,
  filterChips,
  filtersToParams,
  paramsToFilters,
  queueSignature,
  removeChip,
  savedViewPayload,
  stateFromSavedView,
  toItemsQuery,
  orderViews,
  viewsForRole,
} from "../utils/queueState";

describe("viewsForRole", () => {
  it("gives Idea people All ideas and For you only", () => {
    expect(viewsForRole("idea")).toEqual(["all", "for-you"]);
    expect(viewsForRole("viewer")).toEqual(["all", "for-you"]);
  });
  it("adds Leading for Builders and To triage for Owners, triage first", () => {
    expect(viewsForRole("builder")).toEqual(["all", "leading", "for-you"]);
    expect(viewsForRole("owner")).toEqual(["to-triage", "all", "leading", "for-you"]);
  });
  it("opens on the first tab when nothing is remembered", () => {
    const state = decodeQueueState(new URLSearchParams(), "owner");
    expect(state.view).toBe("to-triage");
  });
  it("applies a saved order, drops views the role lost and appends new ones in default order", () => {
    const owner = viewsForRole("owner");
    expect(orderViews(owner, ["for-you", "all", "leading", "to-triage"])).toEqual([
      "for-you",
      "all",
      "leading",
      "to-triage",
    ]);
    // A Builder who was once an Owner: To triage is gone.
    expect(orderViews(viewsForRole("builder"), ["to-triage", "for-you", "all"])).toEqual([
      "for-you",
      "all",
      "leading",
    ]);
    // Only one view saved: the rest follow in the default order; duplicates and junk are ignored.
    expect(orderViews(owner, ["leading", "leading", "nope"])).toEqual([
      "leading",
      "to-triage",
      "all",
      "for-you",
    ]);
    expect(orderViews(owner, undefined)).toEqual(owner);
  });
  it("offers the Board only to Builders and Owners", () => {
    expect(canUseBoard("idea")).toBe(false);
    expect(canUseBoard("builder")).toBe(true);
    expect(canUseBoard("owner")).toBe(true);
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
  it("opens on the first tab with nothing in the URL", () => {
    const state = decodeQueueState(new URLSearchParams(), "idea");
    expect(state).toEqual({ view: "all", filters: {}, layout: "list" });
  });

  it("falls back to the first tab for a view the role can't see", () => {
    expect(decodeQueueState(new URLSearchParams("view=to-triage"), "builder").view).toBe("all");
    expect(decodeQueueState(new URLSearchParams("view=to-triage"), "owner").view).toBe("to-triage");
  });

  it("remembers the last view and layout when the URL names none", () => {
    const state = decodeQueueState(new URLSearchParams(), "builder", {
      view: "leading",
      layout: "board",
    });
    expect(state.view).toBe("leading");
    expect(state.layout).toBe("board");
  });

  it("never gives an Idea person the Board, even from a link", () => {
    expect(decodeQueueState(new URLSearchParams("layout=board"), "idea").layout).toBe("list");
  });

  it("round-trips view, filters, sort, layout, saved view and the open idea", () => {
    const state = {
      view: "all" as const,
      filters: { stage: ["shipped"], votedByMe: true },
      sort: "votes" as const,
      layout: "board" as const,
      savedViewId: "v1",
      open: "OPP-388",
    };
    const encoded = encodeQueueState(state);
    expect(encoded.toString()).toBe(
      "view=all&stage=shipped&votedByMe=1&sort=votes&layout=board&sv=v1&open=OPP-388",
    );
    expect(decodeQueueState(encoded, "owner")).toEqual(state);
  });

  it("omits the view's default sort from the URL", () => {
    expect(
      encodeQueueState({ view: "all", filters: {}, sort: "rank", layout: "list" }).toString(),
    ).toBe("view=all");
  });
});

describe("toItemsQuery", () => {
  it("sends no sort for the sectioned views", () => {
    expect(toItemsQuery({ view: "for-you", filters: {}, layout: "list", sort: "votes" })).toEqual({
      view: "for-you",
    });
  });

  it("sends the view's default sort, the filters and the cursor for flat views", () => {
    expect(toItemsQuery({ view: "all", filters: { goal: ["g1"] }, layout: "list" }, "c2")).toEqual({
      view: "all",
      goal: "g1",
      sort: "rank",
      cursor: "c2",
    });
  });
});

describe("saved views", () => {
  it("stores the contract's params plus view and sort, and reads them back", () => {
    const payload = savedViewPayload({
      view: "all",
      filters: { stage: ["planning"] },
      sort: "newest",
      layout: "list",
    });
    expect(payload).toEqual({ view: "all", stage: "planning", sort: "newest" });
    expect(stateFromSavedView(payload, "idea", "list", "v9")).toEqual({
      view: "all",
      filters: { stage: ["planning"] },
      sort: "newest",
      layout: "list",
      savedViewId: "v9",
      open: undefined,
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

describe("sorting by view", () => {
  it("ranks To triage and All ideas, and leaves only For you with a fixed section order", () => {
    expect(defaultSortFor("to-triage")).toBe("rank");
    expect(defaultSortFor("all")).toBe("rank");
    expect(defaultSortFor("leading")).toBe("waiting");
    expect(isSectionedView("for-you")).toBe(true);
    expect(isSectionedView("to-triage")).toBe(false);
  });
  it("sends a sort for To triage (so its sections are ordered by it) but not for For you", () => {
    const triage = toItemsQuery({ view: "to-triage", filters: {}, layout: "list" });
    expect(triage.sort).toBe("rank");
    expect(toItemsQuery({ view: "for-you", filters: {}, layout: "list" }).sort).toBeUndefined();
  });
});
