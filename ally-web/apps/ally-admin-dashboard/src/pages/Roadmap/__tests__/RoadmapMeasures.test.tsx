import "@constants";
import React from "react";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ROUTES, en } from "@constants";
import type { RoadmapMetrics } from "@types";

const mockMetrics = vi.fn();
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetRoadmapMetricsQuery: (...args: unknown[]) => mockMetrics(...args),
  useGetRoadmapPreferencesQuery: () => ({ data: undefined, isError: false }),
  useSetRoadmapPreferencesMutation: () => [vi.fn()],
}));

import { RoadmapRoleProvider } from "../RoadmapGate";
import { RoadmapMeasuresPage } from "../RoadmapMeasuresPage";
import { roleTabsFor } from "../components/RoadmapAreaNav";
import {
  amberLineMs,
  formatDuration,
  measureRangeOf,
  measuresEmpty,
  percentOf,
  queryForRange,
} from "../utils/measures";

const copy = en.roadmapV2Measures;
const DAY = 86_400_000;

const metrics = (over: Partial<RoadmapMetrics> = {}): RoadmapMetrics => ({
  range: { from: "2026-10-19T00:00:00.000Z", to: "2026-11-18T00:00:00.000Z" },
  generatedAt: "2026-11-17T10:00:00.000Z",
  funnel: {
    captured: 10,
    submitted: 8,
    accepted: 5,
    shipped: 2,
    measured: 1,
    filedWithoutDraft: 3,
  },
  stages: [
    { key: "submitted_accepted", n: 5, medianMs: 2 * DAY, p75Ms: 4 * DAY },
    { key: "accepted_planning", n: 3, medianMs: 3 * 3_600_000, p75Ms: 5 * 3_600_000 },
    { key: "planning_building", n: 0, medianMs: null, p75Ms: null },
    { key: "building_shipped", n: 2, medianMs: 6 * DAY, p75Ms: 9 * DAY },
  ],
  reviewWait: {
    n: 6,
    medianMs: 2 * DAY,
    p75Ms: 5 * DAY,
    waitingNow: 4,
    overAmberNow: 1,
    amberDays: 5,
    longestWaitingMs: 9 * DAY,
  },
  idleLeadReleases: 0,
  releases: {
    held: { total: 3, shadow: 2, byService: [{ service: "be", count: 3 }] },
    failed: { total: 1, byService: [{ service: "frontend", count: 1 }] },
    failingIdeasNow: 1,
  },
  spend: {
    ideas: 2,
    totalUsd: 12.5,
    medianUsd: 6.25,
    p75Usd: 9.37,
    approximate: true,
    top: [
      { code: "OPP-0414", title: "Course reminders", totalUsd: 10, approximate: false },
      { code: "OPP-0420", title: null, totalUsd: 2.5, approximate: true },
    ],
  },
  ...over,
});

const empty = (): RoadmapMetrics =>
  metrics({
    funnel: {
      captured: 0,
      submitted: 0,
      accepted: 0,
      shipped: 0,
      measured: 0,
      filedWithoutDraft: 0,
    },
    stages: metrics().stages.map(s => ({ ...s, n: 0, medianMs: null, p75Ms: null })),
    reviewWait: {
      ...metrics().reviewWait,
      n: 0,
      medianMs: null,
      p75Ms: null,
      waitingNow: 0,
      overAmberNow: 0,
      longestWaitingMs: null,
    },
    releases: {
      held: { total: 0, shadow: 0, byService: [] },
      failed: { total: 0, byService: [] },
      failingIdeasNow: 0,
    },
    spend: { ideas: 0, totalUsd: 0, medianUsd: null, p75Usd: null, approximate: false, top: [] },
  });

const Where: React.FC = () => {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
};

const renderPage = (role = "owner", path = ROUTES.ROADMAP_MEASURES) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <RoadmapRoleProvider value={{ role, can: {} } as never}>
        <Routes>
          <Route
            path={ROUTES.ROADMAP_MEASURES}
            element={
              <>
                <RoadmapMeasuresPage />
                <Where />
              </>
            }
          />
          <Route path={ROUTES.ROADMAP} element={<p>queue</p>} />
        </Routes>
      </RoadmapRoleProvider>
    </MemoryRouter>,
  );

describe("measures helpers", () => {
  it("formats durations in the unit a person reads", () => {
    expect(formatDuration(45_000)).toBe("45 s");
    expect(formatDuration(12 * 60_000)).toBe("12 min");
    expect(formatDuration(5.5 * 3_600_000)).toBe("5.5 h");
    expect(formatDuration(30 * 3_600_000)).toBe("30 h");
    expect(formatDuration(3.25 * DAY)).toBe("3.3 d");
    expect(formatDuration(40 * DAY)).toBe("40 d");
    expect(formatDuration(null)).toBe("");
  });

  it("builds the range as UTC dates, today included, with 30 days as the default", () => {
    const now = new Date("2026-11-17T22:00:00Z").getTime();
    expect(queryForRange("30", now)).toEqual({ from: "2026-10-19", to: "2026-11-17" });
    expect(queryForRange("7", now)).toEqual({ from: "2026-11-11", to: "2026-11-17" });
    expect(measureRangeOf("90")).toBe("90");
    expect(measureRangeOf("forever")).toBe("30");
    expect(measureRangeOf(null)).toBe("30");
  });

  it("divides safely and draws the amber line in calendar time", () => {
    expect(percentOf(5, 10)).toBe(50);
    expect(percentOf(3, 0)).toBe(0);
    expect(amberLineMs(5)).toBe(7 * DAY);
  });

  it("is empty only when nothing happened and nothing waits", () => {
    expect(measuresEmpty(empty())).toBe(true);
    expect(measuresEmpty(metrics())).toBe(false);
    expect(
      measuresEmpty({ ...empty(), reviewWait: { ...empty().reviewWait, waitingNow: 1 } }),
    ).toBe(false);
  });
});

describe("Measures tab", () => {
  it("is an Owner's tab only", () => {
    expect(roleTabsFor("owner").map(t => t.key)).toContain("measures");
    for (const role of ["builder", "idea", "viewer"] as const) {
      expect(roleTabsFor(role).map(t => t.key)).not.toContain("measures");
    }
  });
});

describe("RoadmapMeasuresPage", () => {
  beforeEach(() => mockMetrics.mockReset());

  it("sends anyone but an Owner to the Queue, without asking for the numbers", () => {
    mockMetrics.mockReturnValue({ isLoading: false, isError: false });
    renderPage("builder");
    expect(screen.getByText("queue")).toBeInTheDocument();
    expect(mockMetrics).toHaveBeenCalledWith(expect.anything(), { skip: true });
  });

  it("asks for the last 30 days by default", () => {
    mockMetrics.mockReturnValue({ isLoading: true, isError: false });
    renderPage();
    const [query, options] = mockMetrics.mock.calls[0];
    expect(Object.keys(query).sort()).toEqual(["from", "to"]);
    const span = (new Date(query.to).getTime() - new Date(query.from).getTime()) / DAY;
    expect(span).toBe(29);
    expect(options).toEqual({ skip: false });
    expect(screen.getAllByText(copy.targets.rows[0].name)).toHaveLength(1);
  });

  it("shows a skeleton while loading, and keeps the targets visible", () => {
    mockMetrics.mockReturnValue({ isLoading: true, isError: false });
    const { container } = renderPage();
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.getByRole("heading", { name: copy.targets.title })).toBeInTheDocument();
  });

  it("offers a retry when the numbers fail to load", () => {
    const refetch = vi.fn();
    mockMetrics.mockReturnValue({ isLoading: false, isError: true, refetch });
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent(copy.loadFailed);
    fireEvent.click(screen.getByRole("button", { name: copy.retry }));
    expect(refetch).toHaveBeenCalled();
  });

  it("says so when the range has no ideas", () => {
    mockMetrics.mockReturnValue({ isLoading: false, isError: false, data: empty() });
    renderPage();
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
    expect(screen.queryByText(copy.funnel.title)).toBeNull();
  });

  it("shows the funnel, stage times, review wait, releases and spend", () => {
    mockMetrics.mockReturnValue({ isLoading: false, isError: false, data: metrics() });
    renderPage();

    const funnel = screen.getByRole("region", { name: copy.funnel.title });
    const submitted = within(funnel).getByRole("row", { name: /Submitted/ });
    expect(submitted).toHaveTextContent("8");
    expect(submitted).toHaveTextContent(copy.funnel.share(80));
    expect(within(funnel).getByText(copy.funnel.withoutDraft(3))).toBeInTheDocument();

    const stages = screen.getByRole("region", { name: copy.stages.title });
    expect(within(stages).getByRole("row", { name: /Submitted → Accepted/ })).toHaveTextContent(
      "2.0 d",
    );
    expect(within(stages).getByRole("row", { name: /Planning → Building/ })).toHaveTextContent(
      copy.none,
    );

    const review = screen.getByRole("region", { name: copy.review.title });
    expect(within(review).getByText(copy.review.overAmber(5))).toBeInTheDocument();
    expect(within(review).getByRole("img")).toHaveAccessibleName(
      copy.review.chartLabel("2.0 d", 5),
    );
    expect(within(review).getByTestId("measures-amber-line")).toBeInTheDocument();

    const releases = screen.getByRole("region", { name: copy.releases.title });
    expect(within(releases).getByText(copy.releases.heldShadow(2))).toBeInTheDocument();
    expect(within(releases).getByText(/Admin and helpline/)).toBeInTheDocument();

    const spend = screen.getByRole("region", { name: copy.spend.title });
    expect(within(spend).getByRole("link", { name: /OPP-0414 Course reminders/ })).toHaveAttribute(
      "href",
      ROUTES.ROADMAP_IDEA("OPP-0414"),
    );
    // A private draft is listed by code, with no title and no link.
    const draftRow = within(spend).getByRole("row", { name: /OPP-0420/ });
    expect(draftRow).toHaveTextContent(copy.spend.privateDraft);
    expect(within(draftRow).queryByRole("link")).toBeNull();
    expect(within(spend).getByText(copy.spend.approximate)).toBeInTheDocument();
  });

  it("keeps the picked range in the URL", () => {
    mockMetrics.mockReturnValue({ isLoading: false, isError: false, data: metrics() });
    renderPage();
    // A Carbon listbox, not a native <select>: open it, then pick the option by its words.
    fireEvent.click(screen.getByRole("combobox", { name: copy.rangeLabel }));
    fireEvent.click(screen.getByRole("option", { name: copy.ranges["90"] }));
    expect(screen.getByTestId("where")).toHaveTextContent("/roadmap/measures?range=90");
    const [query] = mockMetrics.mock.calls[mockMetrics.mock.calls.length - 1];
    const span = (new Date(query.to).getTime() - new Date(query.from).getTime()) / DAY;
    expect(span).toBe(89);
  });
});
