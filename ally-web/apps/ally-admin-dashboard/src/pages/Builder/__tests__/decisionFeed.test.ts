import { describe, expect, it } from "vitest";

import type { BuilderDecision } from "@types";

import {
  countByCategory,
  filterDecisions,
  formatDuration,
  optionIndexForKey,
  orderDecisions,
  orderOptions,
  sittingStats,
  splitRationale,
} from "../decisionFeed";

const decision = (overrides: Partial<BuilderDecision>): BuilderDecision => ({
  id: "question:s1:q1",
  kind: "question",
  category: "what",
  sessionId: "s1",
  sessionTitle: "Digest",
  sessionStatus: "INTERVIEWING",
  createdByName: null,
  repos: [],
  prompt: "Monday or Friday?",
  rationale: null,
  questionType: null,
  context: [],
  blocked: "Scoping is paused.",
  selection: "single",
  options: [],
  allowCustom: true,
  allowNone: false,
  minSelections: null,
  customPlaceholder: null,
  waitingSince: "2026-10-28T09:00:00Z",
  pullRequestUrl: null,
  ...overrides,
});

describe("orderDecisions", () => {
  it("puts the cheap, costly-to-wait kinds first, then oldest wait within a kind", () => {
    const ordered = orderDecisions([
      decision({ id: "q-new", kind: "question", waitingSince: "2026-10-28T10:00:00Z" }),
      decision({ id: "failed", kind: "build_failed", category: "issue" }),
      decision({ id: "merge", kind: "pr_merge", category: "issue" }),
      decision({ id: "q-old", kind: "question", waitingSince: "2026-10-28T08:00:00Z" }),
      decision({ id: "budget", kind: "budget", category: "issue" }),
    ]);

    expect(ordered.map(entry => entry.id)).toEqual(["budget", "merge", "q-old", "q-new", "failed"]);
  });

  it("sends skipped cards to the back, in the order they were skipped", () => {
    const ordered = orderDecisions(
      [
        decision({ id: "a", kind: "budget", category: "issue" }),
        decision({ id: "b" }),
        decision({ id: "c" }),
      ],
      ["c", "a"],
    );

    expect(ordered.map(entry => entry.id)).toEqual(["b", "c", "a"]);
  });
});

describe("filterDecisions and countByCategory", () => {
  const all = [
    decision({ id: "1", category: "what" }),
    decision({ id: "2", category: "how", kind: "design_review" }),
    decision({ id: "3", category: "issue", kind: "pr_merge" }),
    decision({ id: "4", category: "issue", kind: "budget" }),
  ];

  it("filters by category and keeps everything for all", () => {
    expect(filterDecisions(all, "issue").map(entry => entry.id)).toEqual(["3", "4"]);
    expect(filterDecisions(all, "all")).toHaveLength(4);
  });

  it("counts per category for the chips", () => {
    expect(countByCategory(all)).toEqual({ all: 4, what: 1, how: 1, issue: 2 });
  });
});

describe("orderOptions", () => {
  it("moves the recommendation first and keeps the rest in the agent's order", () => {
    const ordered = orderOptions([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C", recommended: true },
    ]);

    expect(ordered.map(option => option.id)).toEqual(["c", "a", "b"]);
  });
});

describe("splitRationale", () => {
  it("separates the gate's labelled lines from the model's own", () => {
    expect(
      splitRationale(
        "Both are supported today.\nBased on: X1, the scheduler module\nYours to decide because: the code allows either.",
      ),
    ).toEqual({
      why: "Both are supported today.",
      basis: "X1, the scheduler module",
      yours: "the code allows either.",
    });
  });

  it("returns nulls for an empty rationale", () => {
    expect(splitRationale(null)).toEqual({ why: null, basis: null, yours: null });
  });
});

describe("optionIndexForKey", () => {
  it("maps 1–9 and nothing else", () => {
    expect(optionIndexForKey("1")).toBe(0);
    expect(optionIndexForKey("9")).toBe(8);
    expect(optionIndexForKey("0")).toBeNull();
    expect(optionIndexForKey("a")).toBeNull();
  });
});

describe("sittingStats", () => {
  const opened = Date.parse("2026-10-28T10:00:00Z");

  it("says nothing about pace until there are two answers", () => {
    expect(sittingStats(opened, [])).toEqual({ decided: 0, averageSeconds: null, perHour: null });
    expect(sittingStats(opened, [opened + 30_000])).toEqual({
      decided: 1,
      averageSeconds: null,
      perHour: null,
    });
  });

  it("measures from the page opening to the last answer", () => {
    // Four decisions in two minutes: 30s each, 120 an hour.
    const stats = sittingStats(opened, [
      opened + 20_000,
      opened + 50_000,
      opened + 80_000,
      opened + 120_000,
    ]);

    expect(stats.decided).toBe(4);
    expect(stats.averageSeconds).toBe(30);
    expect(stats.perHour).toBe(120);
  });
});

describe("formatDuration", () => {
  it("picks the size a header can hold", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(130)).toBe("2m 10s");
    expect(formatDuration(120)).toBe("2m");
    expect(formatDuration(3_840)).toBe("1h 4m");
  });
});
