import { describe, expect, it } from "vitest";

import {
  AssessmentAttemptsResponse,
  SHARE_GROUP,
  UNITS_GROUP,
  assessmentAttemptsEmptyText,
  assessmentAttemptsTakeaway,
  buildAssessmentAttemptsSeries,
  formatPerUnit,
  formatShare,
  weekLabel,
} from "../assessmentAttemptsChart";

const response = (over: Partial<AssessmentAttemptsResponse> = {}): AssessmentAttemptsResponse => ({
  totals: {
    units: 10,
    singleValid: 8,
    share: 0.8,
    incompleteStarts: 5,
    incompleteStartsPerUnit: 0.5,
  },
  weeks: [
    { week: "2026-11-02", units: 4, singleValid: 3, share: 0.75, incompleteStarts: 1 },
    { week: "2026-11-09", units: 0, singleValid: 0, share: null, incompleteStarts: 0 },
    { week: "2026-11-16", units: 6, singleValid: 5, share: 5 / 6, incompleteStarts: 4 },
  ],
  ...over,
});

describe("assessment attempts chart transform", () => {
  it("emits a bar per week and a share point (percent) only where there are units", () => {
    const series = buildAssessmentAttemptsSeries(response());
    expect(series.filter(d => d.group === UNITS_GROUP).map(d => [d.key, d.value])).toEqual([
      ["2 Nov", 4],
      ["9 Nov", 0],
      ["16 Nov", 6],
    ]);
    expect(series.filter(d => d.group === SHARE_GROUP).map(d => [d.key, d.value])).toEqual([
      ["2 Nov", 75],
      ["16 Nov", 83.3],
    ]);
  });

  it("falls back to full dates when short labels collide", () => {
    const series = buildAssessmentAttemptsSeries(
      response({
        weeks: [
          { week: "2025-11-17", units: 1, singleValid: 1, share: 1, incompleteStarts: 0 },
          { week: "2026-11-17", units: 1, singleValid: 1, share: 1, incompleteStarts: 0 },
        ],
      }),
    );
    expect(series[0].key).toBe("2025-11-17");
  });

  it("is empty with no units", () => {
    expect(buildAssessmentAttemptsSeries(undefined)).toEqual([]);
    expect(assessmentAttemptsEmptyText(undefined)).not.toBe("");
    expect(
      assessmentAttemptsEmptyText(
        response({
          totals: {
            units: 0,
            singleValid: 0,
            share: null,
            incompleteStarts: 0,
            incompleteStartsPerUnit: null,
          },
        }),
      ),
    ).not.toBe("");
    expect(assessmentAttemptsEmptyText(response())).toBe("");
  });

  it("formats shares, per-unit rates, week labels and the takeaway", () => {
    expect(formatShare(0.8)).toBe("80%");
    expect(formatShare(null)).toBe("—");
    expect(formatPerUnit(0.5)).toBe("0.5");
    expect(formatPerUnit(10)).toBe("10");
    expect(formatPerUnit(null)).toBe("—");
    expect(weekLabel("2026-01-05")).toBe("5 Jan");
    expect(assessmentAttemptsTakeaway(response())).toBe(
      "80% of 10 assessment units (8) had exactly one valid attempt.",
    );
  });
});
