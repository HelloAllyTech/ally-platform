import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StatisticsChartEntry } from "@types";

import { ForYouView } from "../ForYouView";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en", exists: () => false },
  }),
}));
vi.mock("@hooks", () => ({ useUser: () => ({ user: { name: "Asha Rao" } }) }));

const headline = { data: undefined as unknown, skipped: false };
const insights = { data: undefined as unknown };
vi.mock("@api", () => ({
  useGetStatisticsChartQuery: (_args: unknown, options?: { skip?: boolean }) => {
    headline.skipped = !!options?.skip;
    return {
      currentData: options?.skip ? undefined : headline.data,
      isFetching: false,
      isError: false,
    };
  },
  useGetStatisticsInsightsQuery: () => ({ data: insights.data, isLoading: false, isError: false }),
  useUpdateStatisticsInsightStateMutation: () => [vi.fn()],
}));
vi.mock("../renderers", () => ({ CHART_RENDERERS: {} }));
vi.mock("../InsightsSection", () => ({ InsightsSection: () => null }));
vi.mock("../LibraryDrawer", () => ({ LibraryDrawer: () => null }));
vi.mock("../../SortableMetricBlock", () => ({
  SortableMetricBlock: ({ children }: { children: unknown }) => <div>{children as never}</div>,
}));

const entry = (state: StatisticsChartEntry["state"]) =>
  ({ id: "TSQ-001", title: "Headline", state, home: "organisation" }) as StatisticsChartEntry;

const renderIt = (state: StatisticsChartEntry["state"] = "available") =>
  render(
    <ForYouView
      charts={[entry(state)]}
      views={[]}
      pinKeys={[]}
      onPinsChange={() => undefined}
      onOpen={() => undefined}
      onOpenInsight={() => undefined}
    />,
  );

beforeEach(() => {
  headline.data = {
    data: { activeUsers: 12, totalRegisteredLearners: 40, simulationsCompleted: 55 },
  };
  insights.data = { attention: [], celebrate: [] };
});

describe("the For you summary", () => {
  it("says how the month went and that nothing needs a look", () => {
    renderIt();
    const text = screen.getByTestId("statistics-summary").textContent ?? "";
    expect(text).toContain('"active":12');
    expect(text).toContain('"registered":40');
    expect(text).toContain('"count":55');
    expect(text).toContain("summary.nothingNeedsLook");
  });

  it("counts what needs a look, and mentions good news when only that is found", () => {
    insights.data = { attention: [{}, {}], celebrate: [{}] };
    renderIt();
    expect(screen.getByTestId("statistics-summary").textContent).toContain("needsLook");
    expect(screen.getByTestId("statistics-summary").textContent).toContain('"count":2');
    insights.data = { attention: [], celebrate: [{}] };
    renderIt();
    expect(screen.getAllByTestId("statistics-summary")[1].textContent).toContain("celebrateOnly");
  });

  it("leaves out a line it cannot write, and does not ask for numbers the organisation cannot fill", () => {
    insights.data = undefined;
    renderIt("unavailable");
    expect(headline.skipped).toBe(true);
    expect(screen.queryByTestId("statistics-summary")).toBeNull();
  });
});
