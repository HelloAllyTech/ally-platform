import { render, screen, within } from "@testing-library/react";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({ nightly: vi.fn() }));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefNightlyQuery: () => h.nightly(),
}));
vi.mock("@components/charts", () => ({
  LineChart: ({ data }: any) => <div data-testid="line">{data.length}</div>,
}));
vi.mock("../../Analytics/chartKit", () => ({
  PALETTE: {
    blue: "#264D8E",
    teal: "#08bdba",
    purple: "#8a3ffc",
    orange: "#ff832b",
    red: "#fa4d56",
  },
  lineOpts: () => ({}),
  ChartCard: ({ title, empty, children }: any) => (
    <div data-testid={`chart-${title}`}>{empty ? "empty" : children}</div>
  ),
}));

// eslint-disable-next-line import/first
import { NightlyCheckSection } from "../metrics/NightlyCheckSection";

const today = new Date().toISOString().slice(0, 10);
const day = (slice: string, over: Record<string, unknown> = {}, alerts: any[] = []) => ({
  day: today,
  slice,
  metrics: {
    runs: 12,
    wordsP50: 210,
    wordsP90: 280,
    sameness: 0.3,
    specificity: 8,
    evaluatorJudgeGap: 0.2,
    ...over,
  },
  alerts,
});

beforeEach(() => h.nightly.mockReset());

describe("Analytics › Debriefs › Nightly check", () => {
  it("says it has not run yet when there is nothing", () => {
    h.nightly.mockReturnValue({ data: [], isLoading: false, isError: false });
    render(<NightlyCheckSection />);
    expect(screen.getByTestId("nightly-empty")).toHaveTextContent("No nightly check has run yet");
  });

  it("lists alerts in words, data quality, and charts each measure", () => {
    h.nightly.mockReturnValue({
      data: [
        day(
          "all",
          {
            wordsP50: 260,
            dataQuality: { runs: 12, noLanguage: 0, unjudged: 2, stuck: 0, failed: 1 },
          },
          [
            {
              code: "length_creep",
              detail: "Debriefs are longer: 260 words at the median, against 200 before.",
              value: 260,
              baseline: 200,
              routedTo: "Debrief PM agent: testing firmer wording",
            },
          ],
        ),
        day("language:hi"),
        {
          day: today,
          slice: "judge_drift",
          metrics: { drift: 0.1, n: 40, max: 0.3 },
          alerts: [],
        },
      ],
      isLoading: false,
      isError: false,
    });
    render(<NightlyCheckSection />);
    expect(
      within(screen.getByTestId("nightly-alerts")).getByText(/Debriefs are longer/),
    ).toBeTruthy();
    // v2: each finding says where it went; nobody needs to watch this page.
    expect(screen.getByTestId("nightly-routed")).toHaveTextContent(
      "→ Debrief PM agent: testing firmer wording",
    );
    expect(screen.getByTestId("nightly-data-quality")).toHaveTextContent(
      "2 without a quality score yet",
    );
    expect(screen.getByTestId("chart-Words per debrief")).toHaveTextContent("2");
    expect(screen.getByTestId("chart-Judge drift")).not.toHaveTextContent("empty");
  });
});
