import { describe, expect, it } from "vitest";

import type { AllyPairedWeek, AllyRate, AllyWeek } from "@types";

import {
  flaggedWeeks,
  formatFigure,
  formatPercentValue,
  hasPoints,
  hasWithheld,
  pair,
  pairedEngagementSeries,
  pairedLearningSeries,
  rateSeries,
  single,
  toPercent,
  twoSeries,
  valueSeries,
} from "../allyGuideChart";

const rate = (value: number | null, suppressed = false): AllyRate => ({
  rate: value,
  count: 0,
  of: 0,
  learners: 0,
  suppressed,
});

const week = (date: string, overrides: Partial<AllyWeek> = {}): AllyWeek =>
  ({
    week: date,
    activeLearners: 12,
    firstSessionWin: rate(0.5),
    firstWinWithin5Min: rate(0.25),
    itemsPerLearningDay: 1.5,
    sevenDayReturn: rate(0.4),
    appointmentsSet: 3,
    appointmentsKept: rate(0.66),
    voiceAdoption: rate(0.1),
    quizFirstAttemptPass: rate(0.8),
    quizFirstAttemptPassClassic: rate(0.7),
    roleplayScore: 3.2,
    roleplayScoreClassic: 3.0,
    careEntriesPer100: 1,
    crisisEntriesPer100: 0,
    offCourse: rate(0.2),
    refusals: rate(0.05),
    ...overrides,
  }) as AllyWeek;

const paired = (date: string, overrides: Partial<AllyPairedWeek> = {}): AllyPairedWeek => ({
  week: date,
  itemsPerLearningDay: 2,
  thumbsUpShare: 0.9,
  quizFirstAttemptPass: 0.75,
  guard: "ok",
  ...overrides,
});

describe("toPercent", () => {
  it("turns a 0-1 rate into a percentage to one place", () => {
    expect(toPercent(0.5)).toBe(50);
    expect(toPercent(0.12345)).toBe(12.3);
    expect(toPercent(0)).toBe(0);
  });

  it("keeps a withheld rate withheld, never zero", () => {
    expect(toPercent(null)).toBeNull();
    expect(toPercent(undefined)).toBeNull();
  });
});

describe("rateSeries", () => {
  it("plots one point per week, as a percentage, keyed by the week's Monday", () => {
    const series = rateSeries(
      [week("2026-10-12"), week("2026-10-19", { firstSessionWin: rate(0.75) })],
      w => w.firstSessionWin,
      "Within the first session",
    );

    expect(series).toEqual([
      { group: "Within the first session", key: "2026-10-12", value: 50 },
      { group: "Within the first session", key: "2026-10-19", value: 75 },
    ]);
  });

  it("draws a withheld week as a gap, not a zero", () => {
    const series = rateSeries(
      [week("2026-10-12", { sevenDayReturn: rate(null, true) })],
      w => w.sevenDayReturn,
      "Return",
    );

    expect(series[0].value).toBeNull();
  });
});

describe("valueSeries", () => {
  it("passes a plain figure through and keeps a missing one a gap", () => {
    const series = valueSeries(
      [week("2026-10-12"), week("2026-10-19", { roleplayScore: null })],
      w => w.roleplayScore,
      "Score",
    );

    expect(series.map(point => point.value)).toEqual([3.2, null]);
  });
});

describe("hasWithheld", () => {
  const picks = [(w: AllyWeek) => w.firstSessionWin, (w: AllyWeek) => w.firstWinWithin5Min];

  it("is true when any chosen rate in any week was withheld", () => {
    expect(
      hasWithheld(
        [week("2026-10-12"), week("2026-10-19", { firstWinWithin5Min: rate(null, true) })],
        picks,
      ),
    ).toBe(true);
  });

  it("ignores a withheld rate the chart does not plot", () => {
    expect(hasWithheld([week("2026-10-12", { voiceAdoption: rate(null, true) })], picks)).toBe(
      false,
    );
  });

  it("is false for no weeks", () => {
    expect(hasWithheld([], picks)).toBe(false);
  });
});

describe("hasPoints", () => {
  it("needs at least one point that is not a gap", () => {
    expect(hasPoints([])).toBe(false);
    expect(hasPoints([{ group: "g", key: "a", value: null }])).toBe(false);
    expect(
      hasPoints([
        { group: "g", key: "a", value: null },
        { group: "g", key: "b", value: 0 },
      ]),
    ).toBe(true);
  });
});

describe("the paired engagement-vs-learning series", () => {
  const weeks = [
    paired("2026-10-12"),
    paired("2026-10-19", {
      thumbsUpShare: null,
      quizFirstAttemptPass: 0.6,
      guard: "learning_fell",
    }),
  ];

  it("keeps engagement and learning on the same weeks, as separate series", () => {
    const { items, thumbs } = pairedEngagementSeries(weeks, { items: "Items", thumbs: "Up" });
    const learning = pairedLearningSeries(weeks, "Pass");

    expect(items.map(point => point.key)).toEqual(["2026-10-12", "2026-10-19"]);
    expect(thumbs.map(point => point.key)).toEqual(learning.map(point => point.key));
    expect(items.map(point => point.value)).toEqual([2, 2]);
    expect(thumbs.map(point => point.value)).toEqual([90, null]);
    expect(learning.map(point => point.value)).toEqual([75, 60]);
  });

  it("flags engagement that rose while learning stayed flat, and learning that fell, only", () => {
    const flagged = flaggedWeeks([
      paired("2026-10-05"),
      paired("2026-10-12", { guard: "engagement_up_learning_flat" }),
      paired("2026-10-19", { guard: "learning_fell" }),
      paired("2026-10-26", { guard: "too_few" }),
    ]);

    expect(flagged.map(item => item.week)).toEqual(["2026-10-12", "2026-10-19"]);
  });
});

describe("formatting", () => {
  it("rounds a percentage and dashes a missing one", () => {
    expect(formatPercentValue(62.4)).toBe("62%");
    expect(formatPercentValue(null)).toBe("—");
    expect(formatPercentValue(undefined)).toBe("—");
  });

  it("fixes a figure to its places and dashes a missing one", () => {
    expect(formatFigure(1.2345)).toBe("1.2");
    expect(formatFigure(1.2345, 2)).toBe("1.23");
    expect(formatFigure(null)).toBe("—");
  });
});

describe("colour scales", () => {
  it("gives a single series one accent, and a reference series the grey, never a second subject colour", () => {
    const one = single("A");
    const two = pair("A", "B");
    const both = twoSeries("A", "B");

    expect(Object.keys(one)).toEqual(["A"]);
    expect(two.A).toBe(one.A);
    expect(two.B).not.toBe(two.A);
    expect(both.A).toBe(one.A);
    expect(both.B).not.toBe(two.B);
  });
});
