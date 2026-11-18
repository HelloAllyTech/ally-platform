import { describe, expect, it } from "vitest";

import {
  activeFilterCount,
  canUseBoard,
  decodeQueueState,
  encodeQueueState,
  filterChips,
  filtersToParams,
  paramsToFilters,
  queueSignature,
  removeChip,
  savedViewPayload,
  stateFromSavedView,
  toItemsQuery,
  viewsForRole,
} from "../utils/queueState";

describe("viewsForRole", () => {
  it("gives Idea people For you and All ideas only", () => {
    expect(viewsForRole("idea")).toEqual(["for-you", "all"]);
    expect(viewsForRole("viewer")).toEqual(["for-you", "all"]);
  });
  it("adds Leading for Builders and To triage for Owners", () => {
    expect(viewsForRole("builder")).toEqual(["for-you", "leading", "all"]);
    expect(viewsForRole("owner")).toEqual(["for-you", "leading", "to-triage", "all"]);
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
  it("opens on For you with nothing in the URL", () => {
    const state = decodeQueueState(new URLSearchParams(), "idea");
    expect(state).toEqual({ view: "for-you", filters: {}, layout: "list" });
  });

  it("falls back to For you for a view the role can't see", () => {
    expect(decodeQueueState(new URLSearchParams("view=to-triage"), "builder").view).toBe("for-you");
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
