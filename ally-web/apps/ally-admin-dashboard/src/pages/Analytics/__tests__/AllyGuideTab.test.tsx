import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  summary: vi.fn(),
  weekly: vi.fn(),
  paired: vi.fn(),
  courses: vi.fn(),
  tenants: vi.fn(),
  summaryArgs: vi.fn(),
  chartCalls: [] as {
    kind: string;
    data: { group: string; key: string; value: number | null }[];
  }[],
}));

vi.mock("@carbon/charts-react", () => {
  const chart =
    (kind: string) =>
    ({ data }: { data: { group: string; key: string; value: number | null }[] }) => {
      h.chartCalls.push({ kind, data });
      return <div data-testid={`chart-${kind}`} data-points={data.length} />;
    };
  return { LineChart: chart("line"), ComboChart: chart("combo") };
});
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideAnalyticsSummaryQuery: (arg: unknown) => {
    h.summaryArgs(arg);
    return h.summary();
  },
  useGetAllyGuideAnalyticsWeeklyQuery: () => h.weekly(),
  useGetAllyGuideEngagementVsLearningQuery: () => h.paired(),
  useGetAllyGuideAnalyticsCoursesQuery: () => h.courses(),
  useGetTenantsQuery: () => h.tenants(),
}));

// eslint-disable-next-line import/first
import { AnalyticsOrgScopeProvider } from "../analyticsOrgScope";
// eslint-disable-next-line import/first
import { AllyGuideTab } from "../tabs/AllyGuideTab";

const ok = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });

const WINDOW = {
  from: "2026-09-01",
  to: "2026-10-23",
  computedAt: "2026-10-23T06:00:00.000Z",
};

const base = {
  window: WINDOW,
  scoping: { unscopedSections: [] as string[] },
  minGroupSize: 5,
  provenance: "Ally conversations",
};

const rate = (value: number | null, suppressed = false) => ({
  rate: value,
  count: 0,
  of: 0,
  learners: 0,
  suppressed,
});

const week = (date: string, overrides: Record<string, unknown> = {}) => ({
  week: date,
  activeLearners: 12,
  firstSessionWin: rate(0.5),
  firstWinWithin5Min: rate(0.25),
  itemsPerLearningDay: 1.5,
  sevenDayReturn: rate(0.4),
  appointmentsSet: 3,
  appointmentsKept: rate(0.66),
  voiceAdoption: rate(0.1),
  quizFirstAttemptPass: rate(0.8),
  quizFirstAttemptPassClassic: rate(0.7),
  roleplayScore: 3.2,
  roleplayScoreClassic: 3,
  careEntriesPer100: 1,
  crisisEntriesPer100: 0,
  offCourse: rate(0.2),
  refusals: rate(0.05),
  ...overrides,
});

const SUMMARY = {
  ...base,
  learners: 1234,
  conversations: 5678,
  learnerMessages: 91011,
  thumbsUp: { rate: 0.82, count: 41, of: 50, learners: 20, suppressed: false },
  costUsd: 12.3456,
  costPerLearnerUsd: 0.01,
};

const pairedWeek = (date: string, overrides: Record<string, unknown> = {}) => ({
  week: date,
  itemsPerLearningDay: 2,
  thumbsUpShare: 0.9,
  quizFirstAttemptPass: 0.75,
  guard: "ok",
  ...overrides,
});

const QUERY = { range: "90d" as const };
const filters = { query: QUERY, language: "", onSelectLanguage: vi.fn() };

describe("AllyGuideTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.chartCalls.length = 0;
    h.summary.mockReturnValue(ok(SUMMARY));
    h.weekly.mockReturnValue(ok({ ...base, weeks: [week("2026-10-12"), week("2026-10-19")] }));
    h.paired.mockReturnValue(
      ok({
        ...base,
        weeks: [
          pairedWeek("2026-10-12"),
          pairedWeek("2026-10-19", { guard: "engagement_up_learning_flat" }),
          pairedWeek("2026-10-26", { guard: "learning_fell", quizFirstAttemptPass: 0.5 }),
        ],
      }),
    );
    h.courses.mockReturnValue(
      ok({
        ...base,
        courses: [
          {
            trackId: "t-1",
            title: "Active listening",
            learners: 40,
            turns: 900,
            costUsd: 4.5,
            costPerLearnerUsd: 0.1125,
            folded: 0,
          },
          {
            trackId: null,
            title: "Other",
            learners: 9,
            turns: 70,
            costUsd: 0.7,
            costPerLearnerUsd: null,
            folded: 3,
          },
        ],
      }),
    );
    h.tenants.mockReturnValue(
      ok({
        data: [
          { id: "t-2", name: "Zeta", isTestOrganization: false },
          { id: "t-1", name: "Alpha", isTestOrganization: false },
          { id: "t-9", name: "Sandbox", isTestOrganization: true },
        ],
      }),
    );
  });

  it("numbers every chart AAQ-240 to AAQ-251, each once", () => {
    render(<AllyGuideTab {...filters} />);

    for (let id = 240; id <= 251; id += 1) {
      expect(screen.getAllByText(`AAQ-${id}`), `AAQ-${id}`).toHaveLength(1);
    }
  });

  it("leads with the paired engagement-vs-learning chart, before the weekly cards", () => {
    render(<AllyGuideTab {...filters} />);

    const paired = screen.getByTestId("ally-paired");
    const firstWeekly = screen.getByText("AAQ-241");
    expect(
      paired.compareDocumentPosition(firstWeekly) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("AAQ-248")).toBeInTheDocument();
  });

  it("shows the at-a-glance figures, with the rated-up share and cost per learner", () => {
    render(<AllyGuideTab {...filters} />);

    const glance = screen.getByTestId("ally-glance");
    expect(glance).toHaveTextContent("1,234");
    expect(glance).toHaveTextContent("5,678");
    expect(glance).toHaveTextContent("91,011");
    expect(glance).toHaveTextContent("82%");
    expect(glance).toHaveTextContent("41 of 50 rated replies");
    expect(glance).toHaveTextContent("$12.35");
    expect(glance).toHaveTextContent("Cost per learner: $0.01");
  });

  it("withholds the rated-up share and cost per learner under the minimum group, rather than showing zero", () => {
    h.summary.mockReturnValue(
      ok({
        ...SUMMARY,
        thumbsUp: { rate: null, count: 0, of: 0, learners: 2, suppressed: true },
        costPerLearnerUsd: null,
      }),
    );
    render(<AllyGuideTab {...filters} />);

    const glance = screen.getByTestId("ally-glance");
    expect(glance).toHaveTextContent("Fewer than 5 learners, so the rate is withheld.");
    expect(glance).toHaveTextContent("Withheld under 5 learners");
    expect(glance).not.toHaveTextContent("0%");
  });

  it("flags the weeks the guard caught, by name, and lists every week in the table", () => {
    render(<AllyGuideTab {...filters} />);

    const flags = screen.getByTestId("ally-paired-flags");
    expect(within(flags).getByTestId("ally-flag-2026-10-19")).toHaveTextContent(
      "Engagement up, learning flat",
    );
    expect(within(flags).getByTestId("ally-flag-2026-10-26")).toHaveTextContent("Learning fell");
    expect(within(flags).queryByTestId("ally-flag-2026-10-12")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("ally-paired-table")).getAllByRole("row")).toHaveLength(4);
  });

  it("says no week is flagged when none is", () => {
    h.paired.mockReturnValue(ok({ ...base, weeks: [pairedWeek("2026-10-12")] }));
    render(<AllyGuideTab {...filters} />);

    expect(screen.getByTestId("ally-paired-none")).toBeInTheDocument();
  });

  it("plots a withheld rate as a gap, and says why the gap is there", () => {
    h.weekly.mockReturnValue(
      ok({
        ...base,
        weeks: [
          week("2026-10-12"),
          week("2026-10-19", {
            voiceAdoption: { ...rate(null, true), count: 1, of: 2, learners: 2 },
          }),
        ],
      }),
    );
    render(<AllyGuideTab {...filters} />);

    const voice = h.chartCalls.find(
      call => call.data.length === 2 && call.data.every(point => point.group === "Spoke to Ally"),
    );
    expect(voice?.data.map(point => point.value)).toEqual([10, null]);
    expect(
      screen.getByText("Fewer than 5 learners, so the rate is withheld.", { selector: "*" }),
    ).toBeInTheDocument();
  });

  it("says a chart is withheld, not empty, when every rate was withheld", () => {
    const withheld = { ...rate(null, true), count: 1, of: 2, learners: 1 };
    h.weekly.mockReturnValue(
      ok({
        ...base,
        weeks: [
          week("2026-10-12", { voiceAdoption: withheld }),
          week("2026-10-19", { voiceAdoption: withheld }),
        ],
      }),
    );
    render(<AllyGuideTab {...filters} />);

    // Voice adoption has nothing to draw, but there was activity behind it.
    expect(screen.queryByText("No Ally activity in this window.")).toBeNull();
    expect(
      screen.getAllByText("Fewer than 5 learners, so the rate is withheld.", { selector: "*" })
        .length,
    ).toBeGreaterThan(0);
  });

  it("lists the courses with cost per learner, and the folded row by how many it folds", () => {
    render(<AllyGuideTab {...filters} />);

    const [course, folded] = screen.getAllByTestId("ally-course-row");
    expect(course).toHaveTextContent("Active listening");
    expect(course).toHaveTextContent("$4.50");
    expect(course).toHaveTextContent("$0.11");
    expect(folded).toHaveTextContent("Other courses (3)");
    expect(folded).toHaveTextContent("—");
  });

  it("says there is no Ally activity when nothing came back", () => {
    h.weekly.mockReturnValue(ok({ ...base, weeks: [] }));
    h.paired.mockReturnValue(ok({ ...base, weeks: [] }));
    h.courses.mockReturnValue(ok({ ...base, courses: [] }));
    render(<AllyGuideTab {...filters} />);

    expect(screen.getAllByText("No Ally activity in this window.").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("ally-course-row")).not.toBeInTheDocument();
  });

  it("offers a retry for the weekly charts when they fail, without hiding the rest", () => {
    const refetch = vi.fn();
    h.weekly.mockReturnValue({ isLoading: false, isError: true, error: {}, refetch });
    render(<AllyGuideTab {...filters} />);

    expect(
      screen.getAllByText("There was a problem fetching Ally's numbers.").length,
    ).toBeGreaterThan(0);
    expect(screen.getByTestId("ally-glance")).toHaveTextContent("1,234");
    expect(screen.getAllByTestId("ally-course-row")).toHaveLength(2);
  });

  it("offers an organisation picker, real organisations only and alphabetical, and sends the choice", () => {
    render(<AllyGuideTab {...filters} />);

    const picker = screen.getByLabelText("Organisation") as HTMLSelectElement;
    expect(Array.from(picker.options).map(option => option.textContent)).toEqual([
      "All organisations",
      "Alpha",
      "Zeta",
    ]);
    expect(h.summaryArgs).toHaveBeenLastCalledWith({ ...QUERY, tenantId: undefined });

    fireEvent.change(picker, { target: { value: "t-1" } });

    expect(h.summaryArgs).toHaveBeenLastCalledWith({ ...QUERY, tenantId: "t-1" });
  });

  it("notes the sections that stay platform-wide once an organisation is chosen", () => {
    h.summary.mockReturnValue(
      ok({ ...SUMMARY, scoping: { unscopedSections: ["courses", "cost"] } }),
    );
    render(<AllyGuideTab {...filters} />);

    expect(screen.queryByTestId("ally-analytics-scope-note")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Organisation"), { target: { value: "t-1" } });

    expect(screen.getByTestId("ally-analytics-scope-note")).toHaveTextContent(
      "Platform-wide whatever organisation is chosen: courses, cost.",
    );
  });

  it("for an admin restricted to some organisations: no picker, and the page's organisation is the scope", () => {
    render(
      <AnalyticsOrgScopeProvider value={{ restricted: true, tenantId: "t-7" }}>
        <AllyGuideTab {...filters} query={{ ...QUERY, tenantId: "t-7" }} />
      </AnalyticsOrgScopeProvider>,
    );

    expect(screen.queryByLabelText("Organisation")).not.toBeInTheDocument();
    expect(h.summaryArgs).toHaveBeenLastCalledWith({ ...QUERY, tenantId: "t-7" });
  });
});
