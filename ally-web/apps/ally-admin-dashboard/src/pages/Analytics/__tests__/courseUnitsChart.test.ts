import { describe, expect, it } from "vitest";

import {
  COURSE_UNIT_XP,
  CourseUnitsPoint,
  bucketAxisLabel,
  buildCourseUnitsTable,
  courseUnitsEmptyText,
  courseUnitsTakeaway,
  formatUnits,
} from "../courseUnitsChart";

const point = (o: Partial<CourseUnitsPoint> & { bucket: string }): CourseUnitsPoint => ({
  units: 0,
  targetUnits: null,
  learners: 0,
  avgUnitsPerLearner: null,
  ...o,
});

describe("bucketAxisLabel", () => {
  it("adds the year to the first month and to every January", () => {
    expect(bucketAxisLabel("2026-10-01", "month", true)).toBe("Oct 26");
    expect(bucketAxisLabel("2026-02-01", "month", false)).toBe("Feb");
    expect(bucketAxisLabel("2026-01-01", "month", false)).toBe("Jan 26");
  });

  it("labels days/weeks by date and years by year", () => {
    expect(bucketAxisLabel("2026-10-31", "day", false)).toBe("31 Oct");
    expect(bucketAxisLabel("2026-10-26", "week", false)).toBe("26 Oct");
    expect(bucketAxisLabel("2026-01-01", "year", false)).toBe("2026");
  });
});

describe("formatUnits", () => {
  it("shows whole units when large and fractions when small", () => {
    expect(formatUnits(1480)).toBe("1,480");
    expect(formatUnits(12.345)).toBe("12.3");
    expect(formatUnits(0.83)).toBe("0.83");
  });
});

describe("buildCourseUnitsTable", () => {
  it("flags the in-progress bucket and shows a dash for no average", () => {
    const table = buildCourseUnitsTable(
      [
        point({
          bucket: "2026-09-01",
          units: 10,
          targetUnits: 12,
          learners: 4,
          avgUnitsPerLearner: 2.5,
        }),
        point({ bucket: "2026-10-01" }),
      ],
      "2026-10-01",
    );

    expect(table.rows).toEqual([
      ["2026-09-01", 10, 12, 4, 2.5],
      ["2026-10-01 (in progress)", 0, "No target set", 0, "—"],
    ]);
  });
});

describe("courseUnitsEmptyText", () => {
  it("is set only when nobody earned XP anywhere", () => {
    expect(courseUnitsEmptyText([])).toBeDefined();
    expect(courseUnitsEmptyText([point({ bucket: "a" })])).toBeDefined();
    expect(courseUnitsEmptyText([point({ bucket: "a", learners: 1, units: 1 })])).toBeUndefined();
  });
});

describe("courseUnitsTakeaway", () => {
  it("quotes the latest complete bucket, never the in-progress one", () => {
    const points = [
      point({ bucket: "2026-09-01", units: 1320, learners: 500, avgUnitsPerLearner: 2.64 }),
      point({ bucket: "2026-10-01", units: 99, learners: 9, avgUnitsPerLearner: 11 }),
    ];

    expect(courseUnitsTakeaway(points, "2026-10-01", "month")).toBe(
      "1,320 course units from 500 learners, 2.64 each, in the latest complete month",
    );
  });

  it("adds attainment against the target when one is set", () => {
    const points = [
      point({
        bucket: "2026-09-01",
        units: 1320,
        targetUnits: 1500,
        learners: 500,
        avgUnitsPerLearner: 2.64,
      }),
    ];

    expect(courseUnitsTakeaway(points, null, "month")).toBe(
      "1,320 course units (target 1,500, 88%) from 500 learners, 2.64 each, in the latest complete month",
    );
  });

  it("is undefined when only the in-progress bucket exists", () => {
    expect(
      courseUnitsTakeaway([point({ bucket: "2026-10-01" })], "2026-10-01", "month"),
    ).toBeUndefined();
  });
});

it("mirrors the backend unit size", () => {
  expect(COURSE_UNIT_XP).toBe(100);
});
