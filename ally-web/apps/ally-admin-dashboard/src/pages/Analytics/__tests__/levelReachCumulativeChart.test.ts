import { describe, expect, it } from "vitest";

import {
  LEVEL_REACH_CUMULATIVE_GROUP,
  LEVEL_REACH_NET_GROUP,
  buildLevelReachRows,
  buildLevelReachSeries,
  buildLevelReachTable,
  levelReachEmptyText,
  levelReachTakeaway,
} from "../levelReachCumulativeChart";
import { XpLevelReachedPoint } from "../xpLevelReachedChart";

const point = (bucket: string, usersByLevel: number[]): XpLevelReachedPoint => ({
  bucket,
  levelCounts: usersByLevel.map((users, i) => ({ level: i + 1, users })),
});

const points = [
  point("2026-08-01", [10, 2, 0]),
  point("2026-09-01", [0, 3, 1]),
  point("2026-10-01", [5, 0, 1]),
];

describe("buildLevelReachRows", () => {
  it("accumulates first-crossings for the chosen level, with the monthly addition", () => {
    expect(buildLevelReachRows(points, 1)).toEqual([
      { bucket: "2026-08-01", added: 10, cumulative: 10 },
      { bucket: "2026-09-01", added: 0, cumulative: 10 },
      { bucket: "2026-10-01", added: 5, cumulative: 15 },
    ]);
    expect(buildLevelReachRows(points, 2).map(r => r.cumulative)).toEqual([2, 5, 5]);
  });

  it("treats a level missing from the response as zero", () => {
    expect(buildLevelReachRows(points, 5).at(-1)?.cumulative).toBe(0);
  });
});

describe("series, table, empty and takeaway", () => {
  const rows = buildLevelReachRows(points, 1);

  it("emits a bar and a line datum per month", () => {
    const series = buildLevelReachSeries(rows.slice(0, 1));
    expect(series).toEqual([
      { group: LEVEL_REACH_NET_GROUP, key: "2026-08-01", value: 10 },
      { group: LEVEL_REACH_CUMULATIVE_GROUP, key: "2026-08-01", value: 10 },
    ]);
  });

  it("flags the in-progress month in the table", () => {
    const table = buildLevelReachTable(rows, 1, "2026-10-01");
    expect(table.rows.at(-1)?.[0]).toBe("2026-10-01 (in progress)");
  });

  it("is empty only when nobody has reached the level", () => {
    expect(levelReachEmptyText(buildLevelReachRows(points, 5), 5)).toMatch(/L5/);
    expect(levelReachEmptyText(rows, 1)).toBeUndefined();
  });

  it("reports the latest complete month, not the accruing one", () => {
    expect(levelReachTakeaway(rows, 1, "2026-10-01")).toBe(
      "10 learners have reached L1 as of 2026-09 — none added that month",
    );
  });
});
