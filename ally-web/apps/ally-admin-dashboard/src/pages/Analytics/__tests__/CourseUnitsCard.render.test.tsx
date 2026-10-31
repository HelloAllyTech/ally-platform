import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const useGetCourseUnitsQuery = vi.fn();
vi.mock("@api", () => ({
  useGetCourseUnitsQuery: (args: unknown) => useGetCourseUnitsQuery(args),
}));
vi.mock("@components", () => ({ cellTypes: {} }));

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
    const { container } = render(<CourseUnitsCard />);

    expect(screen.getByText("Course units consumed")).toBeTruthy();
    const plot = container.querySelector("svg[aria-label^='Three stacked panels']")!;
    expect(plot.textContent).toContain("1,320");
    expect(plot.textContent).toContain("500");
    expect(plot.textContent).toContain("2.64");
    // October is still accruing: its 40 units / 12 learners must not be drawn.
    expect(plot.textContent).not.toContain("3.33");
    expect(plot.querySelectorAll("title")).toHaveLength(2);
    // The September column carries its configured target (goal / 100).
    expect(plot.textContent).toContain("target 1,500");
    expect(plot.querySelectorAll("line[stroke-width='2.5']")).toHaveLength(1);
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
