import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({ metrics: vi.fn() }));

vi.mock("@components/charts", () => ({
  LineChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="line-chart" data-points={data.length} />
  ),
}));
vi.mock("../../Analytics/chartKit", () => ({
  ChartCard: ({ children, empty, emptyText, caption }: any) => (
    <div data-testid="chart-card">
      <p>{caption}</p>
      {empty ? <p>{emptyText}</p> : children}
    </div>
  ),
  lineOpts: () => ({}),
  PALETTE: { blue: "", teal: "", purple: "", orange: "" },
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefMetricsQuery: () => h.metrics(),
}));

// eslint-disable-next-line import/first
import { MetricsTab, targetState } from "../MetricsTab";

const r = (n: number, of: number) => ({ n, of, value: of ? n / of : null });
const exp = (scale = 1) => ({
  openedWithin24h: r(18 * scale, 20 * scale),
  readThrough: r(15 * scale, 20 * scale),
  practiseClickThrough: r(3 * scale, 20 * scale),
  reflectionAnswered: r(4 * scale, 20 * scale),
  abandonedBeforeReady: r(1 * scale, 20 * scale),
  flagsWithinSla: r(0, 0),
  listened: r(2 * scale, 20 * scale),
  replied: r(6 * scale, 20 * scale),
});
const week = (date: string, score: number | null, missing: string[] = []) => ({
  week: date,
  debriefs: 20,
  steering: {
    value: score,
    missing,
    components: { judge: 9.2, practise: r(3, 20), thumbs: r(8, 10) },
  },
  guardrails: {
    judgeP50: 9.4,
    judgeMean: 9.2,
    judged: 20,
    hardFailRate: r(1, 20),
    fabricatedQuotes: 0,
    thumbsDownRate: r(2, 10),
    visibleSecondsP50: 70,
    visibleSecondsP90: 130,
    costP50: 0.07,
    costP90: 0.1,
    evaluatorJudgeGap: -0.3,
  },
  efficiency: { savedUsdMean: 0.4, revisionRoundsP50: 0, stepsP50: 7, within10Min: r(20, 20) },
  experience: exp(),
});

const VIEW = {
  weeks: 12,
  weights: { judge: 0.5, practise: 0.25, thumbs: 0.25 },
  flagReviewSlaHours: 24,
  series: [week("2026-11-02", 70.1, ["thumbs"]), week("2026-11-09", 72.3)],
  byLanguage: [{ key: "hi-IN", debriefs: 40, experience: exp(2) }],
  byPlatform: [{ key: "ios", debriefs: 40, experience: exp(2) }],
  baselines: {
    from: "2026-10-01T00:00:00Z",
    until: "2026-10-29T00:00:00Z",
    legacyHardFailRate: r(10, 100),
    legacyThumbsDownRate: r(5, 100),
  },
  uptake: [
    { month: "2026-10", pairs: 12, lift: null, lower: null, upper: null, insufficient: true },
    { month: "2026-11", pairs: 160, lift: 0.12, lower: 0.04, upper: 0.2, insufficient: false },
  ],
  safetyRecall: { recorded: false },
  generatedAt: "2026-11-10T00:00:00Z",
};

describe("Debrief metrics (v9 §3.3)", () => {
  beforeEach(() => {
    h.metrics.mockReturnValue({ data: VIEW, isError: false, refetch: vi.fn() });
  });

  it("charts the steering score with its three parts and says which weeks lacked a part", () => {
    render(<MetricsTab />);
    // 2 weeks × (score, judge, practise, thumbs)
    expect(screen.getByTestId("line-chart")).toHaveAttribute("data-points", "8");
    expect(screen.getByTestId("metrics-steering")).toHaveTextContent(
      "Judge 50% · Practise next 25% · Thumbs-up 25%",
    );
    expect(screen.getByTestId("steering-latest")).toHaveTextContent("This week: 72.3");
    expect(screen.getByTestId("steering-partial")).toHaveTextContent("2026-11-02: Without thumbs");
  });

  it("reads uptake lift as insufficient below 150 pairs", () => {
    render(<MetricsTab />);
    expect(screen.getByTestId("uptake-2026-10")).toHaveTextContent(
      "Insufficient data (12 of 150 pairs)",
    );
    expect(screen.getByTestId("uptake-2026-11")).toHaveTextContent(
      "0.12 (0.04 to 0.20) over 160 pairs",
    );
  });

  it("puts every guardrail beside its target, with the baselines", () => {
    render(<MetricsTab />);
    const g = screen.getByTestId("metrics-guardrails");
    expect(g).toHaveTextContent("Below today's debrief: 10%");
    expect(g).toHaveTextContent("Not above before launch: 5%");
    // the slowest 10% took 130 s against 120 s
    const visible = within(g)
      .getByText(/Time to a debrief/)
      .closest("tr")!;
    expect(visible).toHaveTextContent("Off target");
    expect(g).toHaveTextContent("Measured offline by the safety-recall gate");
  });

  it("shows experience over the window with counts, and by language and device", () => {
    render(<MetricsTab />);
    const e = screen.getByTestId("metrics-experience");
    const opened = within(e).getByText("Opened within 24 hours").closest("tr")!;
    expect(opened).toHaveTextContent("90% (36 of 40)");
    expect(opened).toHaveTextContent("On target");
    const ctr = within(e).getByText("Practise-next click-through").closest("tr")!;
    expect(ctr).toHaveTextContent("Off target");
    expect(screen.getByTestId("metrics-by-language")).toHaveTextContent("hi-IN");
    expect(screen.getByTestId("metrics-by-device")).toHaveTextContent("ios");
  });

  it("marks a rate with fewer than 20 counted as too few to read", () => {
    expect(targetState(1, { atLeast: 0.85 }, 5)).toBe("thin");
    expect(targetState(null, { atLeast: 0.85 })).toBe("no_data");
  });

  it("shows the pass rate with its 95% range, by week, language and judge version", () => {
    const group = (n: number, of: number, extra: Record<string, unknown> = {}) => ({
      passRate: { n, of, value: of ? n / of : null, low: 0.62, high: 0.9 },
      outages: 1,
      unjudged: 2,
      hardFailRate: { n: of - n, of, value: of ? (of - n) / of : null },
      judgeMean: 8.4,
      ...extra,
    });
    h.metrics.mockReturnValue({
      data: {
        ...VIEW,
        quality: {
          byWeek: [{ week: "2026-11-02", ...group(24, 30) }],
          byLanguage: [{ language: "hi-IN", debriefs: 30, ...group(24, 30) }],
          bySegment: [
            {
              language: "hi-IN",
              writerModel: "gemini-3-flash-preview",
              judgeVersion: "gemini-2.5-pro/v3+g1",
              debriefs: 30,
              ...group(24, 30),
            },
          ],
        },
      },
      isError: false,
      refetch: vi.fn(),
    });
    render(<MetricsTab />);
    const q = screen.getByTestId("metrics-quality");
    // The window total is summed in the browser with the same Wilson formula ally-be uses.
    expect(screen.getByTestId("metrics-quality-headline")).toHaveTextContent(
      "80% (95% range 62.7%–90.5%, 24 of 30)",
    );
    expect(q).toHaveTextContent("Not ready: a model could not be reached: 1");
    expect(q).toHaveTextContent("Not scored yet: 2");
    expect(screen.getByTestId("metrics-quality-weeks")).toHaveTextContent("95% range 62%–90%");
    expect(screen.getByTestId("metrics-quality-languages")).toHaveTextContent("hi-IN");
    expect(screen.getByTestId("metrics-quality-segments")).toHaveTextContent(
      "gemini-2.5-pro/v3+g1",
    );
  });

  it("says so when no live debrief is in the window", () => {
    h.metrics.mockReturnValue({
      data: { ...VIEW, quality: { byWeek: [], byLanguage: [], bySegment: [] } },
      isError: false,
      refetch: vi.fn(),
    });
    render(<MetricsTab />);
    expect(screen.getByTestId("metrics-quality")).toHaveTextContent(
      "No live debrief in this window.",
    );
  });
});
