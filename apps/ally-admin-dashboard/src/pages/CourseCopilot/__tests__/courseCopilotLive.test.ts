import { describe, expect, it } from "vitest";

import type { CourseCopilotEvent, CourseOutline } from "@types";

import { changedItemIds, formatUsd, mergeEvents } from "../courseCopilotLive";

const item = (id: string, title: string, order: number) =>
  ({
    id,
    type: "ARTICLE",
    order,
    title,
    size: "800 words",
    preview: { type: "ARTICLE", excerpt: "", wordCount: 800, questionCount: 0, resourceCount: 0, imageUrls: [] },
  }) as never;

const outline = (...items: unknown[]): CourseOutline =>
  ({
    trackId: "t1",
    title: "Course",
    sections: [{ id: "s1", order: 0, title: "Intro", items }],
  }) as never;

const event = (seq: number): CourseCopilotEvent => ({
  seq,
  type: "job_done",
  payload: {},
  createdAt: "",
});

describe("formatUsd", () => {
  it("shows dollars and cents", () => {
    expect(formatUsd(1.5)).toBe("$1.50");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("never shows $NaN", () => {
    expect(formatUsd(undefined)).toBe("$0.00");
    expect(formatUsd(null)).toBe("$0.00");
    expect(formatUsd(Number.NaN)).toBe("$0.00");
  });
});

describe("mergeEvents", () => {
  it("returns the detail's events untouched when the socket pushed nothing", () => {
    const base = [event(1), event(2)];
    expect(mergeEvents(base, [])).toBe(base);
  });

  it("de-duplicates by seq and keeps seq order", () => {
    expect(mergeEvents([event(1), event(3)], [event(2), event(3), event(4)]).map(e => e.seq)).toEqual(
      [1, 2, 3, 4],
    );
  });

  it("copes with a detail whose events are missing", () => {
    expect(mergeEvents(undefined as never, [event(1)]).map(e => e.seq)).toEqual([1]);
  });
});

describe("changedItemIds", () => {
  it("is empty when nothing changed", () => {
    expect(changedItemIds(outline(item("a", "A", 0)), outline(item("a", "A", 0)))).toEqual([]);
  });

  it("names an item that is new, or whose content changed", () => {
    const before = outline(item("a", "A", 0), item("b", "B", 1));
    const after = outline(item("a", "A", 0), item("b", "B renamed", 1), item("c", "C", 2));
    expect(changedItemIds(before, after).sort()).toEqual(["b", "c"]);
  });

  // Inserting one item renumbers everything after it; flashing the whole tail would bury the
  // one that actually changed.
  it("does not count a mere renumbering as a change", () => {
    const before = outline(item("a", "A", 0), item("b", "B", 1));
    const after = outline(item("new", "New", 0), item("a", "A", 1), item("b", "B", 2));
    expect(changedItemIds(before, after)).toEqual(["new"]);
  });

  it("treats every item as changed when there was no previous outline", () => {
    expect(changedItemIds(null, outline(item("a", "A", 0)))).toEqual(["a"]);
  });

  it("is empty for a patch with no outline, or a malformed one", () => {
    expect(changedItemIds(outline(item("a", "A", 0)), null)).toEqual([]);
    expect(changedItemIds(null, { sections: "nope" } as never)).toEqual([]);
  });
});
