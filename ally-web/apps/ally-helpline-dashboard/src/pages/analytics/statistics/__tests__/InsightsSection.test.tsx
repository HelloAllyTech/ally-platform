import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StatisticsInsight, StatisticsInsights } from "@types";

import { InsightsSection } from "../InsightsSection";

const names: Record<string, string> = { "statisticsLibrary.skills.names.harm": "Harm" };
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      names[key] ?? (options ? `${key} ${JSON.stringify(options)}` : key),
    i18n: { language: "en", exists: (key: string) => key in names },
  }),
}));

const query = {
  data: undefined as StatisticsInsights | undefined,
  isLoading: false,
  isError: false,
};
const putAway = vi.fn();
vi.mock("@api", () => ({
  useGetStatisticsInsightsQuery: () => query,
  useUpdateStatisticsInsightStateMutation: () => [putAway],
}));

const insight = (over: Partial<StatisticsInsight> = {}): StatisticsInsight => ({
  fingerprint: "learners.dormant:2026-W48",
  ruleId: "learners.dormant",
  polarity: "attention",
  severity: 0.8,
  params: { count: 12, total: 40 },
  chartId: "TSQ-007",
  view: "organisation",
  ...over,
});

beforeEach(() => {
  query.data = undefined;
  query.isLoading = false;
  query.isError = false;
  putAway.mockReset();
});

describe("Your focus today", () => {
  it("says nothing while it loads, and nothing if it cannot load, so the pins below it stay", () => {
    query.isLoading = true;
    const { container, rerender } = render(<InsightsSection onOpen={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    query.isLoading = false;
    query.isError = true;
    rerender(<InsightsSection onOpen={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("says plainly when nothing needs a look", () => {
    query.data = { attention: [], celebrate: [] };
    render(<InsightsSection onOpen={vi.fn()} />);
    expect(screen.getByTestId("statistics-insights-none")).toBeTruthy();
  });

  it("lists what needs a look, then what is worth celebrating, each in its own group", () => {
    query.data = {
      attention: [insight()],
      celebrate: [
        insight({
          fingerprint: "usage.high:2026-W48",
          ruleId: "usage.high",
          polarity: "celebrate",
          chartId: "TSQ-002",
          params: { count: 9, weeks: 12 },
        }),
      ],
    };
    render(<InsightsSection onOpen={vi.fn()} />);
    expect(screen.getByText("statisticsLibrary.insights.attention")).toBeTruthy();
    expect(screen.getByText("statisticsLibrary.insights.celebrate")).toBeTruthy();
    expect(screen.getByTestId("statistics-insight-learners.dormant")).toBeTruthy();
    expect(screen.getByTestId("statistics-insight-usage.high")).toBeTruthy();
  });

  it("writes each sentence from the rule and its numbers, in the reader's language", () => {
    query.data = { attention: [insight()], celebrate: [] };
    render(<InsightsSection onOpen={vi.fn()} />);
    const card = screen.getByTestId("statistics-insight-learners.dormant");
    expect(card.textContent).toContain("statisticsLibrary.insights.items.learners.dormant.title");
    expect(card.textContent).toContain('"count":12');
    expect(card.textContent).toContain(
      "statisticsLibrary.insights.items.learners.dormant.evidence",
    );
    expect(card.textContent).toContain("statisticsLibrary.insights.kinds.learners");
  });

  it("names a skill in the reader's language", () => {
    query.data = {
      attention: [
        insight({
          fingerprint: "skills.weakest:harm:2026-W48",
          ruleId: "skills.weakest",
          chartId: "TSQ-024",
          params: { skill: "harm", level: 2.1 },
        }),
      ],
      celebrate: [],
    };
    render(<InsightsSection onOpen={vi.fn()} />);
    expect(screen.getByTestId("statistics-insight-skills.weakest").textContent).toContain(
      '"skill":"Harm"',
    );
  });

  it("opens the chart a finding comes from", () => {
    const onOpen = vi.fn();
    const found = insight({ view: "course", chartId: "TSQ-045", filters: { course: "c1" } });
    query.data = { attention: [found], celebrate: [] };
    render(<InsightsSection onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId("statistics-insight-open-learners.dormant"));
    expect(onOpen).toHaveBeenCalledWith(found);
  });

  it("marks a finding done, and puts a worrying one off for later", () => {
    query.data = { attention: [insight()], celebrate: [] };
    render(<InsightsSection onOpen={vi.fn()} />);
    fireEvent.click(screen.getByTestId("statistics-insight-done-learners.dormant"));
    expect(putAway).toHaveBeenCalledWith({
      fingerprint: "learners.dormant:2026-W48",
      state: "done",
    });
    fireEvent.click(screen.getByTestId("statistics-insight-later-learners.dormant"));
    expect(putAway).toHaveBeenLastCalledWith({
      fingerprint: "learners.dormant:2026-W48",
      state: "snoozed",
    });
  });

  it("offers no remind-me-later on something to celebrate", () => {
    query.data = {
      attention: [],
      celebrate: [
        insight({ ruleId: "usage.high", polarity: "celebrate", fingerprint: "u:2026-W48" }),
      ],
    };
    render(<InsightsSection onOpen={vi.fn()} />);
    expect(screen.queryByTestId("statistics-insight-later-usage.high")).toBeNull();
    expect(screen.getByTestId("statistics-insight-done-usage.high")).toBeTruthy();
  });
});
