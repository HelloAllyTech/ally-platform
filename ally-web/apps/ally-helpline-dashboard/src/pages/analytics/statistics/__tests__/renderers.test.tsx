import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StatisticsChartEntry } from "@types";

import { CHART_RENDERERS } from "../renderers";

// Show the translation key and its values, so a test can see what the chart said.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

vi.mock("@carbon/charts-react", () => ({ LineChart: () => null }));
vi.mock("../../chartKit", () => ({ PALETTE: { blue: "#000" }, lineOpts: () => ({}) }));
vi.mock("@api", () => ({
  useGetStatisticsChartQuery: () => ({
    data: undefined,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

const entry = (id: string): StatisticsChartEntry => ({
  id,
  title: id,
  question: `${id}?`,
  group: "outcomes",
  shape: "distribution",
  chart: "histogram",
  size: "m",
  state: "available",
  reason: null,
});

/** Draws a data renderer with the given data. */
const draw = (id: string, data: unknown) => {
  const renderer = CHART_RENDERERS[id];
  if (renderer.kind !== "data") throw new Error(`${id} is not a data chart`);
  const Component = renderer.Component;
  return render(<Component entry={entry(id)} data={data} sparse={false} />);
};

const takeaway = (id: string, data: unknown): string | null => {
  const renderer = CHART_RENDERERS[id];
  if (renderer.kind !== "data" || !renderer.takeaway) return null;
  return renderer.takeaway(data, ((key: string, options?: Record<string, unknown>) =>
    options ? `${key} ${JSON.stringify(options)}` : key) as never);
};

describe("every offered chart has a renderer", () => {
  it("covers the live library ids", () => {
    [
      "TSQ-001",
      "TSQ-002",
      "TSQ-003",
      "TSQ-007",
      "TSQ-008",
      "TSQ-009",
      "TSQ-013",
      "TSQ-014",
      "TSQ-015",
      "TSQ-016",
      "TSQ-017",
      "TSQ-020",
      "TSQ-021",
      "TSQ-022",
      "TSQ-023",
      "TSQ-026",
      "TSQ-027",
    ].forEach(id => expect(CHART_RENDERERS[id], id).toBeDefined());
  });

  it("has no renderer for a retired chart", () => {
    expect(CHART_RENDERERS["TSQ-010"]).toBeUndefined();
  });
});

describe("empty states say so plainly", () => {
  it.each([
    ["TSQ-020", { bins: Array(10).fill(0), sessions: 0, median: null }, "scores.none"],
    [
      "TSQ-021",
      { improving: 0, holding: 0, declining: 0, total: 0, threshold: 5 },
      "trends.none",
    ],
    ["TSQ-022", { rows: [] }, "scenarios.none"],
    ["TSQ-026", { stars: [0, 0, 0, 0, 0], count: 0, average: null }, "ratings.none"],
    ["TSQ-027", { completedSessions: 0, reviewedSessions: 0 }, "reviews.none"],
    ["TSQ-017", { truncated: false, stages: [{ key: "assigned", count: 0 }] }, "funnel.none"],
  ])("%s", (id, data, key) => {
    draw(id as string, data);
    expect(screen.getByText(new RegExp(`statisticsLibrary\\.${key}`))).toBeTruthy();
  });
});

describe("charts with data", () => {
  it("TSQ-020 draws ten bars and a takeaway with the median", () => {
    const data = { bins: [0, 0, 0, 0, 3, 1, 13, 132, 171, 0], sessions: 320, median: 80 };
    draw("TSQ-020", data);
    expect(screen.getByTestId("statistics-score-distribution")).toBeTruthy();
    expect(takeaway("TSQ-020", data)).toContain('"median":80');
  });

  it("TSQ-021 reports how many improved out of how many", () => {
    const data = { improving: 8, holding: 5, declining: 0, total: 13, threshold: 5 };
    draw("TSQ-021", data);
    expect(screen.getByTestId("statistics-learner-trends")).toBeTruthy();
    expect(takeaway("TSQ-021", data)).toContain('"improving":8');
    expect(takeaway("TSQ-021", data)).toContain('"total":13');
  });

  it("TSQ-022 names the hardest and the easiest scenario", () => {
    const data = {
      rows: [
        { scenarioId: 1, title: "Hard one", averageScore: 54, sessions: 5 },
        { scenarioId: 2, title: "Easy one", averageScore: 88, sessions: 9 },
      ],
    };
    draw("TSQ-022", data);
    const text = takeaway("TSQ-022", data) as string;
    expect(text).toContain("takeaway.scenarios ");
    expect(text).toContain("Hard one");
    expect(text).toContain("Easy one");
  });

  it("TSQ-022 does not call a single scenario both the hardest and the easiest", () => {
    const data = {
      rows: [{ scenarioId: 1, title: "Only one", averageScore: 70, sessions: 5 }],
    };
    expect(takeaway("TSQ-022", data)).toContain("takeaway.scenarioOne");
  });

  it("TSQ-026 shows the average and a bar per star, with no comments", () => {
    const data = { stars: [11, 5, 55, 36, 135], count: 242, average: 4.2 };
    draw("TSQ-026", data);
    expect(screen.getByTestId("statistics-ratings")).toBeTruthy();
    expect(screen.getByText(/4\.2/)).toBeTruthy();
    expect(takeaway("TSQ-026", data)).toContain('"count":242');
  });

  it("TSQ-027 shows the share of completed sessions shared for review", () => {
    const data = { completedSessions: 371, reviewedSessions: 37 };
    draw("TSQ-027", data);
    // The share is the bar's label (read aloud); the takeaway says it in a sentence.
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain('"percent":10');
    expect(takeaway("TSQ-027", data)).toContain('"reviewed":37');
  });

  it("TSQ-017 funnel shows each stage as a share of what was assigned", () => {
    draw("TSQ-017", {
      truncated: false,
      stages: [
        { key: "assigned", count: 16 },
        { key: "started", count: 8 },
        { key: "halfway", count: 4 },
        { key: "completed", count: 2 },
      ],
    });
    expect(screen.getByTestId("statistics-course-funnel")).toBeTruthy();
    expect(screen.getAllByText(/"percent":50/).length).toBeGreaterThan(0);
  });
});

describe("headline tiles", () => {
  const base = {
    simulationsCompleted: 12,
    activeUsers: 5,
    newLearnersOnboarded: 2,
    totalRegisteredLearners: 10,
    avgSessionsPerActiveLearner: 2.4,
    avgPracticeMinutesPerLearner: 61.6,
    avgDaysToFirstSession: null,
    learnersWithFirstSessionCount: 0,
  };

  it("says how the period compares with the one before, in words", () => {
    draw("TSQ-001", { ...base, previous: { activeUsers: 3, simulationsCompleted: 20 } });
    expect(screen.getByTestId("statistics-headline-active-change").textContent).toContain(
      "changeUp",
    );
    expect(screen.getByTestId("statistics-headline-simulations-change").textContent).toContain(
      "changeDown",
    );
  });

  it("shows no change line when there is nothing to compare with", () => {
    draw("TSQ-001", { ...base, previous: null });
    expect(screen.queryByTestId("statistics-headline-active-change")).toBeNull();
  });
});
