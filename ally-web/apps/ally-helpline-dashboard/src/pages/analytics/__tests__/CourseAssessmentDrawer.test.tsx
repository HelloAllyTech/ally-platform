import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CourseAssessmentDrawer } from "../CourseAssessmentDrawer";

const mockQuery = vi.fn();

vi.mock("@api", () => ({
  useGetCourseAssessmentPairsQuery: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock("@components", () => ({
  Drawer: ({ open, title, children }: any) =>
    open ? (
      <div>
        <div>{title}</div>
        {children}
      </div>
    ) : null,
}));

const summary = (score: number | null, extra: Record<string, unknown> = {}) => ({
  score,
  submittedAt: "2026-11-01T00:00:00.000Z",
  incompleteStarts: 0,
  reopened: false,
  ...extra,
});

const pair = (overrides: Record<string, unknown> = {}) => ({
  pairKey: "k1",
  preItem: { id: "a", title: "Baseline call", scenarioId: 1 },
  postItem: { id: "b", title: "Final call", scenarioId: 2 },
  comparability: { comparable: true, onlyInPre: [], onlyInPost: [] },
  learners: [
    {
      userId: 1,
      name: "Asha Rao",
      pre: summary(40, { incompleteStarts: 2 }),
      post: summary(70, { reopened: true }),
      gain: 30,
    },
  ],
  cohort: { n: 1, avgPre: null, avgPost: null, avgGain: null, suppressed: true, minGroupSize: 5 },
  ...overrides,
});

const respond = (pairs: unknown[]) =>
  mockQuery.mockReturnValue({
    data: { trackId: "t1", pairs },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });

const renderDrawer = () =>
  render(
    <CourseAssessmentDrawer open onClose={vi.fn()} trackId="t1" courseTitle="Active Listening" />,
  );

describe("CourseAssessmentDrawer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the empty state when the course has no pairs", () => {
    respond([]);
    renderDrawer();
    expect(screen.getByTestId("course-assessment-empty")).toHaveTextContent(
      "This course has no pre/post assessments.",
    );
  });

  it("withholds averages for a small cohort and shows the learner row", () => {
    respond([pair()]);
    renderDrawer();
    expect(screen.getByTestId("assessment-cohort-suppressed")).toHaveTextContent(
      "Averages appear once 5 learners have both",
    );
    expect(screen.queryByText("Avg gain")).not.toBeInTheDocument();
    const row = screen.getByTestId("assessment-learner-row");
    expect(row).toHaveTextContent("Asha Rao");
    expect(row).toHaveTextContent("+30");
    expect(screen.getByTestId("assessment-post")).toHaveTextContent("Reopened");
    expect(screen.getByTestId("assessment-pre")).not.toHaveTextContent("Reopened");
  });

  it("shows cohort averages once they are released", () => {
    respond([
      pair({
        cohort: {
          n: 6,
          avgPre: 41.2,
          avgPost: 68,
          avgGain: 26.8,
          suppressed: false,
          minGroupSize: 5,
        },
      }),
    ]);
    renderDrawer();
    expect(screen.queryByTestId("assessment-cohort-suppressed")).not.toBeInTheDocument();
    expect(screen.getByTestId("assessment-cohort")).toHaveTextContent("+26.8");
  });

  it("warns when the pair's scenarios score different behaviours", () => {
    respond([
      pair({ comparability: { comparable: false, onlyInPre: ["Empathy"], onlyInPost: [] } }),
    ]);
    renderDrawer();
    const warning = screen.getByTestId("assessment-not-comparable");
    expect(warning).toHaveTextContent("may not be comparable");
    expect(warning).toHaveTextContent("Empathy");
  });
});
