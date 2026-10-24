import { describe, expect, it } from "vitest";

import { AllyGuideBaselineCohort, AllyGuideBaselineSnapshot } from "@types";

import {
  BASELINE_METRICS,
  BASELINE_WINDOW_DEFAULT,
  BASELINE_WINDOW_MAX,
  BASELINE_WINDOW_MIN,
  baselineDifference,
  BaselineMetric,
  cohortValue,
  engagementLearningGuard,
  parseBaselineWindow,
  pickSnapshots,
  visibleCohorts,
} from "../baselineCompare";

const cohort = (overrides: Partial<AllyGuideBaselineCohort> = {}): AllyGuideBaselineCohort => ({
  enrollments: 100,
  completionRate: 0.4,
  medianDaysToComplete: 5,
  itemsCompletedPerEnrollment: 3,
  firstDayWinRate: 0.5,
  returnWithin7dRate: 0.3,
  quizFirstAttempts: 80,
  quizFirstAttemptPassRate: 0.7,
  ...overrides,
});

const snapshot = (
  id: string,
  cohorts: Record<string, AllyGuideBaselineCohort>,
): AllyGuideBaselineSnapshot => ({
  id,
  windowDays: 90,
  windowStart: "2026-07-01T00:00:00.000Z",
  windowEnd: "2026-09-29T00:00:00.000Z",
  capturedByUserId: 5,
  note: null,
  metrics: { cohorts, publicCourses: 12, definitions: {} },
  createdAt: "2026-09-29T00:00:00.000Z",
});

const metric = (key: BaselineMetric["key"]) =>
  BASELINE_METRICS.find(candidate => candidate.key === key) as BaselineMetric;

describe("BASELINE_METRICS", () => {
  it("keeps engagement and learning in groups of their own, so they can be read together", () => {
    const groups = (group: string) =>
      BASELINE_METRICS.filter(candidate => candidate.group === group).map(c => c.key);

    expect(groups("learning")).toEqual(["quizFirstAttemptPassRate"]);
    expect(groups("engagement")).toEqual([
      "completionRate",
      "medianDaysToComplete",
      "itemsCompletedPerEnrollment",
      "firstDayWinRate",
      "returnWithin7dRate",
    ]);
    expect(groups("volume")).toEqual(["enrollments"]);
  });

  it("treats a longer time to complete as the wrong direction and every other measure as higher-is-better", () => {
    expect(metric("medianDaysToComplete").higherIsBetter).toBe(false);
    expect(metric("completionRate").higherIsBetter).toBe(true);
    expect(metric("quizFirstAttemptPassRate").higherIsBetter).toBe(true);
    expect(metric("enrollments").higherIsBetter).toBeNull();
  });
});

describe("visibleCohorts", () => {
  it("lists the cohorts that have anyone in them, in the plan's order, and never 'all'", () => {
    const latest = snapshot("b", {
      all: cohort({ enrollments: 300 }),
      unknown: cohort({ enrollments: 100 }),
      in_app: cohort({ enrollments: 50 }),
      guided: cohort({ enrollments: 30 }),
      public_link: cohort({ enrollments: 0 }),
    });

    expect(visibleCohorts(latest)).toEqual(["guided", "in_app", "unknown"]);
  });

  it("is empty for a pre-launch snapshot where everything is 'unknown'", () => {
    expect(visibleCohorts(snapshot("a", { all: cohort(), unknown: cohort() }))).toEqual([
      "unknown",
    ]);
  });
});

describe("cohortValue", () => {
  it("reads a figure, and null for a missing cohort or a null figure", () => {
    expect(cohortValue(cohort(), "completionRate")).toBe(0.4);
    expect(cohortValue(undefined, "completionRate")).toBeNull();
    expect(cohortValue(cohort({ completionRate: null }), "completionRate")).toBeNull();
  });
});

describe("baselineDifference", () => {
  it("is points for a rate, with the sign and the direction", () => {
    expect(baselineDifference(metric("completionRate"), 0.4, 0.46)).toEqual({
      text: "+6.0 pts",
      direction: "better",
    });
    expect(baselineDifference(metric("returnWithin7dRate"), 0.3, 0.2)).toEqual({
      text: "−10.0 pts",
      direction: "worse",
    });
  });

  it("calls fewer days to complete better", () => {
    expect(baselineDifference(metric("medianDaysToComplete"), 5, 3.5)).toEqual({
      text: "−1.5 days",
      direction: "better",
    });
    expect(baselineDifference(metric("medianDaysToComplete"), 5, 6)).toEqual({
      text: "+1.0 days",
      direction: "worse",
    });
  });

  it("compares items per enrolment as a plain number", () => {
    expect(baselineDifference(metric("itemsCompletedPerEnrollment"), 3, 3.4)).toEqual({
      text: "+0.4",
      direction: "better",
    });
  });

  it("says no difference when it rounds to nothing, and compares nothing for a volume or a gap", () => {
    expect(baselineDifference(metric("completionRate"), 0.4, 0.40003).text).toBe("No difference");
    expect(baselineDifference(metric("enrollments"), 100, 40)).toEqual({
      text: null,
      direction: null,
    });
    expect(baselineDifference(metric("completionRate"), null, 0.4)).toEqual({
      text: null,
      direction: null,
    });
  });
});

describe("pickSnapshots", () => {
  it("takes the newest and the oldest, newest-first as the API returns them", () => {
    const [a, b, c] = [snapshot("c", {}), snapshot("b", {}), snapshot("a", {})];

    expect(pickSnapshots([a, b, c])).toEqual({ latest: a, first: c });
  });

  it("takes the snapshot the server marks as first, even when it sits beyond the page", () => {
    const newest = snapshot("c", {});
    const middle = snapshot("b", {});
    const marked = { ...snapshot("a", {}), first: true };

    expect(pickSnapshots([newest, middle, marked])).toEqual({ latest: newest, first: marked });
    // Marked first but listed alone with a newer one: still the before, not the latest.
    expect(pickSnapshots([newest, marked])).toEqual({ latest: newest, first: marked });
  });

  it("has no 'first' when there is only one, since a snapshot is not a comparison with itself", () => {
    const only = snapshot("a", {});

    expect(pickSnapshots([only])).toEqual({ latest: only, first: null });
  });

  it("is empty with nothing captured", () => {
    expect(pickSnapshots([])).toEqual({ latest: null, first: null });
    expect(pickSnapshots(undefined)).toEqual({ latest: null, first: null });
  });
});

describe("parseBaselineWindow", () => {
  it("reads a whole number of days from 7 to 365", () => {
    expect(parseBaselineWindow("7")).toBe(7);
    expect(parseBaselineWindow(String(BASELINE_WINDOW_DEFAULT))).toBe(90);
    expect(parseBaselineWindow(" 365 ")).toBe(365);
  });

  it("refuses a window outside the range or not plainly a number", () => {
    for (const text of ["6", "366", "0", "-7", "", "ninety", "30.5", "1e2", "90 days"]) {
      expect(parseBaselineWindow(text)).toBeNull();
    }
    expect(BASELINE_WINDOW_MIN).toBe(7);
    expect(BASELINE_WINDOW_MAX).toBe(365);
  });
});

describe("engagementLearningGuard", () => {
  const first = snapshot("a", { all: cohort({ enrollments: 400 }) });

  it("is null when there are no guided learners to compare", () => {
    expect(engagementLearningGuard(first, snapshot("b", { all: cohort() }))).toBeNull();
    expect(
      engagementLearningGuard(first, snapshot("b", { guided: cohort({ enrollments: 0 }) })),
    ).toBeNull();
  });

  it("fires when engagement is up on two measures and quiz pass is lower", () => {
    const latest = snapshot("b", {
      guided: cohort({
        enrollments: 60,
        completionRate: 0.55,
        firstDayWinRate: 0.7,
        returnWithin7dRate: 0.25,
        quizFirstAttemptPassRate: 0.6,
        quizFirstAttempts: 50,
      }),
    });

    const guard = engagementLearningGuard(first, latest);

    expect(guard?.triggered).toBe(true);
    expect(guard?.improved).toEqual(["completionRate", "firstDayWinRate"]);
    // The sizes ride along so the warning can show how small the cohorts are.
    expect(guard).toMatchObject({
      guidedEnrollments: 60,
      baselineEnrollments: 400,
      guidedQuizAttempts: 50,
      baselinePass: 0.7,
      guidedPass: 0.6,
    });
  });

  it("stays quiet when learning is up or the same, however engagement moved", () => {
    const up = snapshot("b", {
      guided: cohort({ completionRate: 0.6, firstDayWinRate: 0.8, quizFirstAttemptPassRate: 0.75 }),
    });
    const flat = snapshot("b", {
      guided: cohort({ completionRate: 0.6, firstDayWinRate: 0.8, quizFirstAttemptPassRate: 0.7 }),
    });

    expect(engagementLearningGuard(first, up)?.triggered).toBe(false);
    // "Flat" is the reader's call: no invented tolerance flags it.
    expect(engagementLearningGuard(first, flat)?.triggered).toBe(false);
  });

  it("stays quiet when engagement is up on only one measure", () => {
    const latest = snapshot("b", {
      guided: cohort({
        completionRate: 0.6,
        firstDayWinRate: 0.4,
        returnWithin7dRate: 0.2,
        quizFirstAttemptPassRate: 0.5,
      }),
    });

    expect(engagementLearningGuard(first, latest)?.triggered).toBe(false);
  });

  it("stays quiet, rather than guessing, when either quiz figure is missing", () => {
    const latest = snapshot("b", {
      guided: cohort({
        completionRate: 0.6,
        firstDayWinRate: 0.8,
        quizFirstAttemptPassRate: null,
      }),
    });

    expect(engagementLearningGuard(first, latest)?.triggered).toBe(false);
  });
});
