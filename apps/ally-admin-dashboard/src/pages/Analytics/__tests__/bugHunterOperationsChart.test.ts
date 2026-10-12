import { describe, expect, it } from "vitest";

import { BugHuntTrigger, BugHunterOperationsDay, BugHunterOperationsMetrics } from "@types";

import {
  OUTCOME_ACCEPTED,
  OUTCOME_DECLINED,
  OUTCOME_UNDECIDED,
  buildFiledSeries,
  buildSpendSeries,
  buildSpendTable,
  filedTakeaway,
  rangeToDays,
  spendBucket,
  spendTakeaway,
} from "../bugHunterOperationsChart";

const tokens = (input = 0, output = 0, runs = 0, costUsd = 0) => ({
  runs,
  inputTokens: input,
  outputTokens: output,
  costUsd,
});
const allTokens = () => ({
  [BugHuntTrigger.SCHEDULED]: tokens(),
  [BugHuntTrigger.MANUAL]: tokens(),
  [BugHuntTrigger.FIX_SESSION]: tokens(),
  [BugHuntTrigger.VERIFY_FIX]: tokens(),
  [BugHuntTrigger.VERIFY_FINDINGS]: tokens(),
  [BugHuntTrigger.PR_REVIEW]: tokens(),
});
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
  tokens: allTokens(),
  ...over,
});

const metrics = (over: Partial<BugHunterOperationsMetrics> = {}): BugHunterOperationsMetrics => ({
  windowDays: 30,
  since: "2026-08-29T00:00:00.000Z",
  days: [],
  totals: { ...outcomes(), inputTokens: 0, outputTokens: 0, costUsd: 0, runs: 0 },
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
          totals: { ...outcomes(8, 3, 2, 3), inputTokens: 0, outputTokens: 0, costUsd: 0, runs: 0 },
        }),
      ),
    ).toBe("8 filed · 60% of the 5 ruled on were accepted");
    expect(
      filedTakeaway(
        metrics({
          totals: { ...outcomes(4, 0, 0, 4), inputTokens: 0, outputTokens: 0, costUsd: 0, runs: 0 },
        }),
      ),
    ).toBe("4 filed — none ruled on yet");
  });
});

describe("spend over time", () => {
  const spent = (date: string, scheduled: number, fix = 0) =>
    day(date, {
      tokens: {
        ...allTokens(),
        [BugHuntTrigger.SCHEDULED]: { ...tokens(), runs: 1, costUsd: scheduled },
        [BugHuntTrigger.FIX_SESSION]: { ...tokens(), runs: fix ? 1 : 0, costUsd: fix },
      },
    });

  it("buckets a day by itself, by the Monday of its week, or by its month", () => {
    expect(spendBucket("2026-10-01", "day")).toBe("2026-10-01");
    // 2026-10-01 is a Thursday; 2026-10-04 a Sunday; 2026-10-05 a Monday.
    expect(spendBucket("2026-10-01", "week")).toBe("Wk of 2026-09-28");
    expect(spendBucket("2026-10-04", "week")).toBe("Wk of 2026-09-28");
    expect(spendBucket("2026-10-05", "week")).toBe("Wk of 2026-10-05");
    expect(spendBucket("2026-10-01", "month")).toBe("2026-10");
  });

  it("sums cost per bucket and trigger, keeping buckets in date order", () => {
    const days = [spent("2026-09-30", 1.1), spent("2026-10-01", 2.2, 0.5), spent("2026-10-05", 4)];

    const byDay = buildSpendSeries(days, "day");
    expect(byDay.filter(p => p.group === "Nightly sweep").map(p => [p.key, p.value])).toEqual([
      ["2026-09-30", 1.1],
      ["2026-10-01", 2.2],
      ["2026-10-05", 4],
    ]);

    const byWeek = buildSpendSeries(days, "week");
    expect(byWeek.filter(p => p.group === "Nightly sweep").map(p => [p.key, p.value])).toEqual([
      ["Wk of 2026-09-28", 3.3],
      ["Wk of 2026-10-05", 4],
    ]);
    expect(byWeek.find(p => p.group === "Fix session" && p.key === "Wk of 2026-09-28")?.value).toBe(
      0.5,
    );

    const byMonth = buildSpendSeries(days, "month");
    expect(byMonth.filter(p => p.group === "Nightly sweep").map(p => [p.key, p.value])).toEqual([
      ["2026-09", 1.1],
      ["2026-10", 6.2],
    ]);
  });

  it("tables every bucket with a total and a run count", () => {
    const table = buildSpendTable(
      [spent("2026-09-30", 1.1), spent("2026-10-01", 2.2, 0.5)],
      "month",
    );
    expect(table.columns[0]).toBe("Month (UTC)");
    expect(table.columns).toContain("Total (USD)");
    expect(table.rows).toEqual([
      ["2026-09", 1.1, 0, 0, 0, 0, 1.1, 1],
      ["2026-10", 2.2, 0, 0.5, 0, 0, 2.7, 2],
    ]);
  });

  it("names the total, the average per period and the peak", () => {
    const days = [spent("2026-09-30", 1), spent("2026-10-01", 3)];
    const data = {
      days,
      totals: {
        filed: 0,
        accepted: 0,
        declined: 0,
        undecided: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 4,
        runs: 2,
      },
    } as unknown as Parameters<typeof spendTakeaway>[0];
    expect(spendTakeaway(data, "day")).toMatch(
      /\$4\.00 over the window · \$2\.00 per day on average · most in 2026-10-01 \(\$3\.00\)/,
    );
    expect(spendTakeaway(data, "month")).toMatch(/per month on average · most in 2026-10/);
  });
});
