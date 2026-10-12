import { describe, expect, it } from "vitest";

import { BugHunterOperationsDay, BugHunterOperationsMetrics } from "@types";

import {
  OUTCOME_ACCEPTED,
  OUTCOME_DECLINED,
  OUTCOME_UNDECIDED,
  buildFiledSeries,
  filedTakeaway,
  rangeToDays,
} from "../bugHunterOperationsChart";

const outcomes = (filed = 0, accepted = 0, declined = 0, undecided = 0) => ({
  filed,
  accepted,
  declined,
  undecided,
});

const day = (date: string, over: Partial<BugHunterOperationsDay> = {}): BugHunterOperationsDay => ({
  date,
  filed: 0,
  accepted: 0,
  declined: 0,
  undecided: 0,
  ...over,
});

const metrics = (over: Partial<BugHunterOperationsMetrics> = {}): BugHunterOperationsMetrics => ({
  windowDays: 30,
  since: "2026-08-29T00:00:00.000Z",
  days: [],
  totals: outcomes(),
  ...over,
});

describe("rangeToDays", () => {
  it("maps the page range onto the endpoint's day count, capping at its maximum", () => {
    expect(rangeToDays({ range: "30d" })).toBe(30);
    expect(rangeToDays({ range: "90d" })).toBe(90);
    expect(rangeToDays({ range: "12m" })).toBe(365);
    expect(rangeToDays({ range: "all" })).toBe(365);
    expect(rangeToDays({})).toBe(30);
  });

  it("reads a custom range as 'from that day until today', since the endpoint is anchored on now", () => {
    const now = new Date("2026-09-28T12:00:00.000Z");
    expect(rangeToDays({ from: "2026-09-21", to: "2026-09-25" }, now)).toBe(8);
    expect(rangeToDays({ from: "2020-01-01", to: "2020-02-01" }, now)).toBe(365);
  });
});

describe("filed series", () => {
  it("emits the three outcomes as stacked groups over every day, quiet days included", () => {
    const series = buildFiledSeries([
      day("2026-09-26"),
      day("2026-09-27", { filed: 6, accepted: 3, declined: 2, undecided: 1 }),
    ]);
    expect(series).toEqual([
      { group: OUTCOME_ACCEPTED, key: "2026-09-26", value: 0 },
      { group: OUTCOME_ACCEPTED, key: "2026-09-27", value: 3 },
      { group: OUTCOME_DECLINED, key: "2026-09-26", value: 0 },
      { group: OUTCOME_DECLINED, key: "2026-09-27", value: 2 },
      { group: OUTCOME_UNDECIDED, key: "2026-09-26", value: 0 },
      { group: OUTCOME_UNDECIDED, key: "2026-09-27", value: 1 },
    ]);
  });

  it("states the accepted share over what was ruled on, never over what was filed", () => {
    expect(
      filedTakeaway(
        metrics({
          totals: outcomes(8, 3, 2, 3),
        }),
      ),
    ).toBe("8 filed · 60% of the 5 ruled on were accepted");
    expect(
      filedTakeaway(
        metrics({
          totals: outcomes(4, 0, 0, 4),
        }),
      ),
    ).toBe("4 filed — none ruled on yet");
  });
});
