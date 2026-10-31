import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const useGetCourseUnitsQuery = vi.fn();
vi.mock("@api", () => ({
  useGetCourseUnitsQuery: (args: unknown) => useGetCourseUnitsQuery(args),
}));
vi.mock("@components", () => ({ cellTypes: {} }));
const carbonCharts = vi.hoisted(() => ({
  GroupedBarChart: vi.fn(() => null),
  LineChart: vi.fn(() => null),
}));
vi.mock("@carbon/charts-react", () => carbonCharts);

import { CourseUnitsCard } from "../CourseUnitsCard";

const response = {
  window: { label: "Last 12 months", inProgressBucket: "2026-10-01", bucket: "month" },
  unitXp: 100,
  points: [
    {
      bucket: "2026-08-01",
      units: 1150,
      targetUnits: null,
      learners: 450,
      avgUnitsPerLearner: 2.56,
    },
    {
      bucket: "2026-09-01",
      units: 1320,
      targetUnits: 1500,
      learners: 500,
      avgUnitsPerLearner: 2.64,
    },
    { bucket: "2026-10-01", units: 40, targetUnits: 2000, learners: 12, avgUnitsPerLearner: 3.33 },
  ],
  scoping: { tenantId: null, unscopedSections: [] },
  computedAt: "2026-10-31T12:00:00.000Z",
};

const mockQuery = (data: unknown, extra = {}) =>
  useGetCourseUnitsQuery.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...extra,
  });

describe("CourseUnitsCard", () => {
  it("plots units, learners and the average, and leaves the in-progress period off", () => {
    mockQuery(response);
    render(<CourseUnitsCard />);

    expect(screen.getByText("Course units consumed")).toBeTruthy();
    const [units, learners, average] = [
      carbonCharts.GroupedBarChart.mock.calls[0][0],
      carbonCharts.GroupedBarChart.mock.calls[1][0],
      carbonCharts.LineChart.mock.calls[0][0],
    ];
    // October is still accruing: it must not be drawn in any panel.
    const keys = (d: { data: { key: string }[] }) => d.data.map(x => x.key);
    expect(keys(units)).not.toContain("Oct");
    expect(learners.data.map((d: { value: number }) => d.value)).toEqual([450, 500]);
    expect(average.data.map((d: { value: number }) => d.value)).toEqual([2.56, 2.64]);
    // Only September has a target (goal / 100); August has none, so no datum, not 0.
    expect(units.data.filter((d: { group: string }) => d.group.startsWith("Target"))).toEqual([
      { group: "Target", key: "Sep", value: 1500 },
    ]);
  });

  it("asks for a 12-month window at the default month grain", () => {
    mockQuery(response);
    render(<CourseUnitsCard />);

    expect(useGetCourseUnitsQuery).toHaveBeenCalledWith({ bucket: "month", range: "12m" });
  });

  it("says so when nobody has earned XP", () => {
    mockQuery({
      ...response,
      points: [
        {
          bucket: "2026-09-01",
          units: 0,
          targetUnits: null,
          learners: 0,
          avgUnitsPerLearner: null,
        },
      ],
    });
    render(<CourseUnitsCard />);

    expect(screen.getByText("No learner has earned XP on this axis yet.")).toBeTruthy();
  });
});
