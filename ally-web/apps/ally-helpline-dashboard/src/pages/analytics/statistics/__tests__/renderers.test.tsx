import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StatisticsChartEntry } from "@types";

import { CHART_RENDERERS } from "../renderers";

// Show the translation key and its values, so a test can see what the chart said.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en", exists: () => false },
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
      "TSQ-005",
      "TSQ-006",
      "TSQ-007",
      "TSQ-008",
      "TSQ-009",
      "TSQ-011",
      "TSQ-012",
      "TSQ-013",
      "TSQ-014",
      "TSQ-015",
      "TSQ-016",
      "TSQ-017",
      "TSQ-018",
      "TSQ-019",
      "TSQ-020",
      "TSQ-021",
      "TSQ-022",
      "TSQ-023",
      "TSQ-024",
      "TSQ-026",
      "TSQ-041",
      "TSQ-043",
      "TSQ-045",
      "TSQ-046",
      "TSQ-053",
      "TSQ-063",
      "TSQ-064",
      "TSQ-065",
      "TSQ-038",
      "TSQ-039",
      "TSQ-042",
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
    ["TSQ-021", { improving: 0, holding: 0, declining: 0, total: 0, threshold: 5 }, "trends.none"],
    ["TSQ-022", { rows: [] }, "scenarios.none"],
    ["TSQ-026", { stars: [0, 0, 0, 0, 0], count: 0, average: null }, "ratings.none"],
    ["TSQ-027", { completedSessions: 0, reviewedSessions: 0 }, "reviews.none"],
    ["TSQ-017", { truncated: false, stages: [{ key: "assigned", count: 0 }] }, "funnel.none"],
    ["TSQ-005", { cells: [], sessions: 0, timezone: "UTC" }, "heatmap.none"],
    [
      "TSQ-006",
      { bins: [], boundsMinutes: [2, 5], sessions: 0, medianMinutes: null },
      "length.none",
    ],
    ["TSQ-011", { stages: [{ key: "registered", count: 0 }] }, "activation.none"],
    ["TSQ-012", { regular: 0, occasional: 0, bursty: 0, total: 0, weeks: 12 }, "regularity.none"],
    ["TSQ-018", { rows: [] }, "formats.none"],
    ["TSQ-019", { rows: [] }, "quiz.none"],
    ["TSQ-024", { rows: [] }, "skills.none"],
    ["TSQ-042", { weeks: [], enrolled: 0, completed: 0 }, "performance.none"],
    ["TSQ-043", { bins: [], boundsDays: [1, 3], completed: 0, medianDays: null }, "finish.none"],
    ["TSQ-064", { rows: [] }, "learnerCourses.none"],
    ["TSQ-045", { rows: [] }, "modules.none"],
    ["TSQ-046", { rows: [] }, "modules.timeNone"],
    ["TSQ-053", { rows: [] }, "roleplay.none"],
    ["TSQ-065", { skills: [] }, "skillTrend.none"],
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

describe("practice-habit and skill charts", () => {
  it("TSQ-005 names the busiest day and hour band", () => {
    const cells = Array.from({ length: 7 }, () => Array(8).fill(0));
    cells[1][4] = 9;
    const data = { cells, sessions: 9, timezone: "Asia/Kolkata" };
    draw("TSQ-005", data);
    expect(screen.getByTestId("statistics-practice-heatmap")).toBeTruthy();
    expect(takeaway("TSQ-005", data)).toContain('"from":12');
  });

  it("TSQ-006 reports the median session length", () => {
    const data = {
      bins: [1, 4, 6, 3, 1, 0, 0],
      boundsMinutes: [2, 5, 10, 15, 20, 30],
      sessions: 15,
      medianMinutes: 7,
    };
    draw("TSQ-006", data);
    expect(screen.getByTestId("statistics-session-length")).toBeTruthy();
    expect(takeaway("TSQ-006", data)).toContain('"median":7');
  });

  it("TSQ-011 shows each stage against those registered", () => {
    const data = {
      stages: [
        { key: "registered", count: 10 },
        { key: "started", count: 6 },
        { key: "completed", count: 4 },
        { key: "recent", count: 3 },
      ],
    };
    draw("TSQ-011", data);
    expect(screen.getByTestId("statistics-activation")).toBeTruthy();
    expect(takeaway("TSQ-011", data)).toContain('"started":6');
  });

  it("TSQ-012 splits learners into regular, occasional and bursty", () => {
    const data = { regular: 3, occasional: 4, bursty: 5, total: 12, weeks: 12 };
    draw("TSQ-012", data);
    expect(screen.getByTestId("statistics-regularity")).toBeTruthy();
    expect(takeaway("TSQ-012", data)).toContain('"bursty":5');
  });

  it("TSQ-018 leads with the item format fewest people finish", () => {
    const data = {
      rows: [{ type: "ROLEPLAY_SIMULATION", reached: 20, completed: 8, completedPercent: 40 }],
    };
    draw("TSQ-018", data);
    expect(screen.getByTestId("statistics-item-formats")).toBeTruthy();
    expect(takeaway("TSQ-018", data)).toContain('"percent":40');
  });

  it("TSQ-019 names the quiz with the lowest pass rate", () => {
    const data = { rows: [{ title: "Hard quiz", attempts: 9, passRatePercent: 33 }] };
    draw("TSQ-019", data);
    expect(screen.getByTestId("statistics-quiz-pass")).toBeTruthy();
    expect(takeaway("TSQ-019", data)).toContain("Hard quiz");
  });

  it("TSQ-024 shows first and latest level per skill", () => {
    const data = {
      rows: [
        { skill: "EMPATHY", first: 2, latest: 3.5 },
        { skill: "LISTENING", first: 3, latest: 3 },
      ],
    };
    draw("TSQ-024", data);
    expect(screen.getByTestId("statistics-skill-change")).toBeTruthy();
    expect(takeaway("TSQ-024", data)).toContain('"delta":1.5');
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

describe("the remaining release-set charts", () => {
  it("TSQ-038 says how many courses are live", () => {
    const data = {
      measures: [
        { key: "courses", value: 6, format: "count" },
        { key: "live", value: 4, format: "count" },
      ],
    };
    draw("TSQ-038", data);
    expect(screen.getByTestId("statistics-measures")).toBeTruthy();
    expect(takeaway("TSQ-038", data)).toContain('"live":4');
  });

  it("TSQ-039 names how many learners are on a course", () => {
    const data = {
      measures: [
        { key: "learnersOnCourses", value: 12, format: "count" },
        { key: "inProgress", value: 7, format: "count" },
      ],
    };
    expect(takeaway("TSQ-039", data)).toContain('"inProgress":7');
  });

  it("TSQ-042 reports finished enrolments out of all of them", () => {
    const data = {
      weeks: [{ week: "2026-11-02", started: 5, completed: 2 }],
      enrolled: 5,
      completed: 2,
    };
    draw("TSQ-042", data);
    expect(screen.getByTestId("statistics-course-performance")).toBeTruthy();
    expect(takeaway("TSQ-042", data)).toContain('"completed":2');
  });

  it("TSQ-043 reports the typical days to finish", () => {
    const data = {
      bins: [0, 1, 2, 0, 0, 0],
      boundsDays: [1, 3, 7, 14, 30],
      completed: 3,
      medianDays: 4,
    };
    draw("TSQ-043", data);
    expect(screen.getByTestId("statistics-time-to-finish")).toBeTruthy();
    expect(takeaway("TSQ-043", data)).toContain('"median":4');
  });

  it("TSQ-045 points at the module where most learners stop", () => {
    const data = {
      rows: [
        { sectionId: "a", title: "Basics", reached: 10, completed: 9 },
        { sectionId: "b", title: "Listening", reached: 9, completed: 3 },
      ],
    };
    draw("TSQ-045", data);
    expect(screen.getByTestId("statistics-module-funnel")).toBeTruthy();
    expect(takeaway("TSQ-045", data)).toContain("Listening");
  });

  it("TSQ-046 names the slowest module", () => {
    const data = {
      rows: [
        { sectionId: "a", title: "Basics", medianMinutes: 20, learners: 5 },
        { sectionId: "b", title: "Practice", medianMinutes: 300, learners: 4 },
      ],
    };
    draw("TSQ-046", data);
    expect(takeaway("TSQ-046", data)).toContain("Practice");
  });

  it("TSQ-053 names the roleplay that takes the most tries and shows its course when across courses", () => {
    const data = {
      rows: [
        {
          itemId: "a",
          title: "First call",
          courseTitle: "Foundations",
          learners: 6,
          averageAttempts: 1.2,
          averageMinutes: 8,
        },
        {
          itemId: "b",
          title: "Hard call",
          courseTitle: "Advanced",
          learners: 3,
          averageAttempts: 3.5,
          averageMinutes: 11,
        },
      ],
    };
    draw("TSQ-053", data);
    expect(screen.getByText(/Advanced/)).toBeTruthy();
    expect(takeaway("TSQ-053", data)).toContain("Hard call");
  });

  it("TSQ-063 reports sessions over weeks of practice", () => {
    const data = {
      measures: [
        { key: "sessions", value: 12, format: "count" },
        { key: "activeWeeks", value: 5, format: "count" },
      ],
    };
    expect(takeaway("TSQ-063", data)).toContain('"weeks":5');
  });

  it("TSQ-065 reports the skill that rose the most", () => {
    const data = {
      skills: [
        {
          skill: "empathy",
          points: [
            { slice: 1, level: 2 },
            { slice: 2, level: 4 },
          ],
        },
        {
          skill: "probing",
          points: [
            { slice: 1, level: 3 },
            { slice: 2, level: 3 },
          ],
        },
      ],
    };
    draw("TSQ-065", data);
    expect(screen.getByTestId("statistics-skill-trend")).toBeTruthy();
    expect(takeaway("TSQ-065", data)).toContain('"latest":4');
  });
});

describe("the course and learner overviews", () => {
  it("TSQ-041 says how many of those enrolled have finished, or that nobody is enrolled", () => {
    const facts = (enrolled: number, completed: number) => ({
      measures: [
        { key: "enrolled", value: enrolled, format: "count" },
        { key: "completed", value: completed, format: "count" },
      ],
    });
    expect(takeaway("TSQ-041", facts(20, 12))).toContain('"completed":12');
    expect(takeaway("TSQ-041", facts(0, 0))).toBe("statisticsLibrary.takeaway.courseFactsNone");
    draw("TSQ-041", facts(20, 12));
    expect(screen.getByTestId("statistics-measures")).toBeTruthy();
  });

  it("TSQ-064 lists each course with its progress and counts finished ones", () => {
    const data = {
      rows: [
        {
          courseId: "a",
          title: "Basics",
          completedItems: 5,
          totalItems: 5,
          status: "completed",
          lastActivityAt: null,
        },
        {
          courseId: "b",
          title: "Advanced",
          completedItems: 2,
          totalItems: 6,
          status: "inProgress",
          lastActivityAt: null,
        },
      ],
    };
    draw("TSQ-064", data);
    expect(screen.getByTestId("statistics-learner-courses")).toBeTruthy();
    expect(screen.getByText("Advanced")).toBeTruthy();
    expect(takeaway("TSQ-064", data)).toContain('"done":1');
    expect(takeaway("TSQ-064", { rows: [] })).toBeNull();
  });
});

describe("pinned cards", () => {
  const t = ((key: string, options?: Record<string, unknown>) =>
    options ? `${key} ${JSON.stringify(options)}` : key) as never;
  const pin = (id: string, data: unknown) => {
    const renderer = CHART_RENDERERS[id];
    if (renderer.kind !== "data" || !renderer.pin) throw new Error(`${id} cannot be pinned`);
    return renderer.pin(data, t);
  };

  it("pins the headline active learners, with the change on the previous period", () => {
    const summary = pin("TSQ-001", {
      activeUsers: 86,
      totalRegisteredLearners: 142,
      previous: { activeUsers: 77, simulationsCompleted: 10 },
    });
    expect(summary?.value).toBe("86");
    expect(summary?.change).toEqual({
      text: 'statisticsLibrary.headline.changeUp {"count":9}',
      tone: "good",
    });
  });

  it("has no change for all time, where there is nothing to compare with", () => {
    const summary = pin("TSQ-001", { activeUsers: 5, totalRegisteredLearners: 9, previous: null });
    expect(summary?.change).toBeNull();
  });

  it("pins the latest week of usage with its trend, and reads a fall as bad news", () => {
    const summary = pin("TSQ-002", {
      activeUsers: [
        { bucket: "a", count: 10 },
        { bucket: "b", count: 7 },
      ],
    });
    expect(summary?.series).toEqual([10, 7]);
    expect(summary?.value).toBe("7");
    expect(summary?.change?.tone).toBe("bad");
  });

  it("reads more learners needing attention as a number, not a change", () => {
    expect(pin("TSQ-023", { total: 24, rows: [] })?.value).toBe("24");
  });

  it("pins the share of sessions reviewed, and nothing when there are none", () => {
    expect(pin("TSQ-027", { completedSessions: 200, reviewedSessions: 50 })?.value).toBe("25%");
    expect(pin("TSQ-027", { completedSessions: 0, reviewedSessions: 0 })).toBeNull();
  });

  it("pins the average rating to one decimal, and nothing before there are ratings", () => {
    expect(pin("TSQ-026", { stars: [0, 0, 0, 1, 2], count: 3, average: 4.666 })?.value).toBe("4.7");
    expect(pin("TSQ-026", { stars: [0, 0, 0, 0, 0], count: 0, average: null })).toBeNull();
  });

  it("pins the typical session score, and nothing without sessions", () => {
    expect(pin("TSQ-020", { bins: [], sessions: 63, median: 69 })?.value).toBe("69");
    expect(pin("TSQ-020", { bins: [], sessions: 0, median: null })).toBeNull();
  });

  it("pins courses live and learners on courses from their facts cards", () => {
    const courses = {
      measures: [
        { key: "courses", value: 12, format: "count" },
        { key: "live", value: 9, format: "count" },
      ],
    };
    expect(pin("TSQ-038", courses)?.value).toBe("9");
    const participation = { measures: [{ key: "learnersOnCourses", value: 30, format: "count" }] };
    expect(pin("TSQ-039", participation)?.value).toBe("30");
  });

  it("does not let a table be pinned", () => {
    ["TSQ-009", "TSQ-013"].forEach(id => {
      const renderer = CHART_RENDERERS[id];
      expect(renderer.kind === "data" && "pin" in renderer && renderer.pin).toBeFalsy();
    });
  });
});
