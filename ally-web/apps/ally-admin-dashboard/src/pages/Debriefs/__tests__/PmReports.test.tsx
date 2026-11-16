import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  pmAgent: vi.fn(),
  reports: vi.fn(),
  report: vi.fn(),
  permissions: [] as string[],
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("react-redux", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSelector: (pick: (state: unknown) => unknown) =>
    pick({ user: { permissions: h.permissions } }),
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefOverviewQuery: () => ({ data: undefined }),
  useGetPmAgentStateQuery: () => h.pmAgent(),
  useGetDebriefSettingsQuery: () => ({ data: undefined }),
  useGetDebriefAutonomyQuery: () => ({ data: undefined }),
  useGetDebriefAttentionQuery: () => ({ data: undefined }),
  useRunPmAgentMutation: () => [vi.fn(), { isLoading: false }],
  useBuildDebriefTestSetsMutation: () => [vi.fn(), { isLoading: false }],
  useDecideIdeaMutation: () => [vi.fn(), { isLoading: false }],
  useApprovePinnedRuleMutation: () => [vi.fn(), { isLoading: false }],
  useRejectPinnedRuleMutation: () => [vi.fn(), { isLoading: false }],
  useWithdrawPinnedRuleMutation: () => [vi.fn(), { isLoading: false }],
  useScreenIdeaMutation: () => [vi.fn(), { isLoading: false }],
  useAskIdeaQuestionMutation: () => [vi.fn(), { isLoading: false }],
  useStartIdeaStepMutation: () => [vi.fn(), { isLoading: false }],
  useGetPmAgentReportsQuery: () => h.reports(),
  useGetPmAgentReportQuery: (arg: { kind: string; period: string }, opts?: { skip?: boolean }) =>
    opts?.skip ? { data: undefined } : h.report(arg),
}));

/* eslint-disable import/first */
import { PmAgentPage } from "../pm/PmAgentPage";
import { periodForKind } from "../pm/ReportsView";
import { ok, TEAM_PERMS } from "./consoleFixtures";
/* eslint-enable import/first */

// A weekly report is listed under the week it looks back on: written Monday 9 Nov, it is
// "Week of 2 Nov". This week has records but no report until next Monday.
const LIST = [
  {
    kind: "weekly",
    period: "2026-11-09",
    title: "Week of 9 Nov",
    publishedAt: null,
    hasReview: false,
  },
  {
    kind: "weekly",
    period: "2026-11-02",
    title: "Week of 2 Nov",
    publishedAt: "2026-11-09T02:00:00Z",
    hasReview: true,
  },
  {
    kind: "monthly",
    period: "2026-11",
    title: "November 2026",
    publishedAt: null,
    hasReview: false,
  },
  {
    kind: "weekly",
    period: "2026-10-26",
    title: "Week of 26 Oct",
    publishedAt: "2026-11-02T02:00:00Z",
    hasReview: true,
  },
  {
    kind: "weekly",
    period: "2026-10-19",
    title: "Week of 19 Oct",
    publishedAt: "2026-10-26T02:00:00Z",
    hasReview: true,
  },
  {
    kind: "monthly",
    period: "2026-10",
    title: "October 2026",
    publishedAt: "2026-11-01T03:00:00Z",
    hasReview: true,
  },
  {
    kind: "monthly",
    period: "2026-09",
    title: "September 2026",
    publishedAt: null,
    hasReview: false,
  },
] as const;

const EMPTY_CHANGED = {
  from: "",
  to: "",
  liveForEveryone: { count: 0, byPerson: 0, items: [] },
  reverted: { count: 0, items: [] },
  rejected: { count: 0, items: [] },
  tests: { count: 0, passed: 0, quickChecks: 0, passTests: 0, trials: 0 },
  sentToBuilder: { count: 0 },
  budget: null,
};

const OCTOBER = {
  kind: "monthly",
  period: "2026-10",
  title: "October 2026",
  review: {
    text: "The biggest gain came from putting the important moment first.\n\nNext month: test a Hindi Writer prompt.",
    publishedAt: "2026-11-01T03:00:00Z",
  },
  changed: {
    ...EMPTY_CHANGED,
    liveForEveryone: {
      count: 2,
      byPerson: 2,
      items: [
        {
          releaseId: "r5",
          version: 5,
          ideaId: "1234567890ab",
          title: "The important moment comes first in every debrief",
          at: "2026-10-06T05:00:00Z",
          approvedBy: { id: 7, name: "Tanuja" },
          standing: { status: "standing" },
        },
        {
          releaseId: "r6",
          version: 6,
          ideaId: null,
          title: "Shorter lines",
          at: "2026-10-25T05:00:00Z",
          approvedBy: { id: 9, name: "Gopi" },
          standing: { status: "reverted", at: "2026-10-28T05:00:00Z" },
        },
      ],
    },
    reverted: {
      count: 1,
      items: [
        {
          releaseId: "r7",
          version: 7,
          ideaId: "abcdef123456",
          title: "Drop the opening line",
          at: "2026-10-22T05:00:00Z",
          how: "try_out_reverted",
          by: null,
          reason: "a learner try-out missed a risk cue",
        },
      ],
    },
    rejected: {
      count: 2,
      items: [
        {
          ideaId: "99999999aaaa",
          title: "Use aap in every Hindi debrief",
          at: "2026-10-10T05:00:00Z",
          withdrawn: false,
          by: { id: 7, name: "Tanuja" },
          reason: "depends on the organisation",
        },
        {
          ideaId: "88888888bbbb",
          title: "Shorter safety section",
          at: "2026-10-12T05:00:00Z",
          withdrawn: true,
          by: { id: 8, name: "Asha" },
          reason: "changed my mind",
        },
      ],
    },
    tests: { count: 14, passed: 9, quickChecks: 8, passTests: 4, trials: 2 },
    sentToBuilder: { count: 1 },
    budget: { spentUsd: 24.8, capUsd: 40, parts: { testsUsd: 19.7, pmAgentUsd: 5.1 } },
  },
};

const WEEK = {
  kind: "weekly",
  period: "2026-11-02",
  title: "Week of 2 Nov",
  review: { text: "Scores are up this week.", publishedAt: "2026-11-09T02:00:00Z" },
  changed: EMPTY_CHANGED,
};

const Where = () => {
  const l = useLocation();
  return <div data-testid="where">{l.search}</div>;
};

const renderAt = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/debriefs/pm-agent${search}`]}>
      <PmAgentPage />
      <Where />
    </MemoryRouter>,
  );

const where = () => new URLSearchParams(screen.getByTestId("where").textContent ?? "");

beforeEach(() => {
  vi.clearAllMocks();
  h.permissions = TEAM_PERMS;
  h.pmAgent.mockReturnValue(
    ok({ report: null, at: null, ideas: [], counts: { open: 0, closed: 0 } }),
  );
  h.reports.mockReturnValue(ok(LIST));
  h.report.mockImplementation(({ kind, period }: { kind: string; period: string }) => {
    if (kind === "monthly" && period === "2026-10") return ok(OCTOBER);
    if (kind === "weekly" && period === "2026-11-02") return ok(WEEK);
    return ok({
      kind,
      period,
      title: period,
      review: null,
      changed: {
        ...EMPTY_CHANGED,
        budget:
          kind === "monthly"
            ? { spentUsd: 0, capUsd: 30, parts: { testsUsd: 0, pmAgentUsd: 0 } }
            : null,
      },
    });
  });
});

describe("PM agent › Reports", () => {
  it("is a tab between Releases and Test sets", () => {
    renderAt("?view=reports&kind=monthly&period=2026-10");
    const tabs = within(screen.getByRole("navigation", { name: "PM agent" }))
      .getAllByRole("link")
      .map(a => a.textContent);
    expect(tabs).toEqual(["Ideas", "Releases", "Reports", "Test sets"]);
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");
  });

  it("shows a month: header, what changed from the records, and the review", () => {
    renderAt("?view=reports&kind=monthly&period=2026-10");
    expect(screen.getByTestId("pm-report-kicker")).toHaveTextContent(
      "Monthly review · published 1 Nov 2026",
    );
    expect(screen.getByTestId("pm-report-title")).toHaveTextContent("October 2026");
    expect(screen.getByTestId("pm-report-title")).toHaveAttribute("title", "October 2026");
    expect(screen.getByTestId("pm-report-title")).toHaveClass("truncate");
    // The page header keeps one row at lg; below lg the actions take a second row on purpose.
    expect(screen.getByTestId("pm-header")).toHaveClass("min-[1056px]:flex-nowrap");
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("title", "PM agent");
    const changed = screen.getByTestId("pm-report-changed");
    expect(changed).toHaveTextContent("What changed this month");
    expect(changed).toHaveTextContent(
      "Taken from the records of releases and ideas, not written by the PM agent.",
    );
    expect(screen.getByTestId("pm-report-tile-live")).toHaveTextContent(
      "Live for everyone2all approved by a person",
    );
    expect(screen.getByTestId("pm-report-tile-reverted")).toHaveTextContent(
      "a learner try-out missed a risk cue",
    );
    expect(screen.getByTestId("pm-report-tile-rejected")).toHaveTextContent("with reasons");
    expect(screen.getByTestId("pm-report-tile-tests")).toHaveTextContent("Tests run149 passed");
    expect(screen.getByTestId("pm-report-tile-builder")).toHaveTextContent("Sent to Builder1");

    const live = screen.getByTestId("pm-report-list-live");
    expect(live).toHaveTextContent("Went live for everyone");
    expect(live).toHaveTextContent("Approved by Tanuja · 6 Oct · still standing at 14 days");
    expect(live).toHaveTextContent("Approved by Gopi · 25 Oct · reverted on 28 Oct");
    // An idea's row links to the idea; a release without one to the release.
    expect(within(live).getByRole("link", { name: "12345678" })).toHaveAttribute(
      "href",
      "/debriefs/pm-agent?idea=1234567890ab",
    );
    expect(within(live).getByRole("link", { name: "v6" })).toHaveAttribute(
      "href",
      "/debriefs/pm-agent?view=releases&releaseId=r6",
    );
    expect(screen.getByTestId("pm-report-list-reverted")).toHaveTextContent(
      "Reverted automatically · 22 Oct · a learner try-out missed a risk cue",
    );
    const rejected = screen.getByTestId("pm-report-list-rejected");
    expect(rejected).toHaveTextContent("Rejected by Tanuja · “depends on the organisation”");
    expect(rejected).toHaveTextContent("Withdrawn by Asha");
    expect(screen.getByTestId("pm-report-budget")).toHaveTextContent(
      "$24.80 of $40.00 spent: tests $19.70, PM agent runs $5.10",
    );
    expect(screen.getByText("The PM agent's review")).toBeInTheDocument();
    expect(
      screen.getByText("Written by the PM agent from the month's evidence."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("pm-report-review").querySelectorAll("p")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Download as PDF" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All releases" })).toHaveAttribute(
      "href",
      "/debriefs/pm-agent?view=releases",
    );
  });

  it("opens the newest month by default", () => {
    renderAt("?view=reports");
    expect(screen.getByTestId("pm-report-title")).toHaveTextContent("November 2026");
  });

  it("a month with records but no review yet says when it is published", () => {
    renderAt("?view=reports&kind=monthly&period=2026-11");
    expect(screen.getByTestId("pm-report-kicker")).toHaveTextContent(
      "Monthly review · not published yet",
    );
    expect(screen.getByTestId("pm-report-changed")).toBeInTheDocument();
    expect(screen.getByTestId("pm-report-review-pending")).toHaveTextContent(
      "The PM agent's review is published on the 1st.",
    );
  });

  it("disables Next on the newest and Previous on the oldest, and moves between periods", () => {
    renderAt("?view=reports&kind=monthly&period=2026-11");
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous month" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(where().get("period")).toBe("2026-10");
    expect(screen.getByTestId("pm-report-title")).toHaveTextContent("October 2026");
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(where().get("period")).toBe("2026-09");
    expect(screen.getByRole("button", { name: "Previous month" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next month" })).toBeEnabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Month" }), {
      target: { value: "2026-11" },
    });
    expect(where().get("period")).toBe("2026-11");
  });

  it("switching kind keeps you near the same date, in the URL", () => {
    renderAt("?view=reports&kind=monthly&period=2026-10");
    fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
    // October's latest weekly report.
    expect(where().get("kind")).toBe("weekly");
    expect(where().get("period")).toBe("2026-10-26");
    expect(screen.getByRole("button", { name: "Weekly" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(where().get("period")).toBe("2026-11-02");
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    expect(where().get("kind")).toBe("monthly");
    expect(where().get("period")).toBe("2026-11");
  });

  it("works out the period when switching kind", () => {
    const list = [...LIST];
    expect(periodForKind(list, { kind: "monthly", period: "2026-09" }, "weekly")).toBe(
      "2026-11-09",
    );
    expect(periodForKind(list, { kind: "weekly", period: "2026-10-19" }, "monthly")).toBe(
      "2026-10",
    );
    expect(periodForKind(list, { kind: "weekly", period: "2026-08-03" }, "monthly")).toBe(
      "2026-11",
    );
  });

  it("shows a weekly report under the week it looks back on, with when it was written", () => {
    renderAt("?view=reports&kind=weekly&period=2026-11-02");
    expect(screen.getByTestId("pm-report-kicker")).toHaveTextContent(
      "Weekly report · written Monday 9 Nov",
    );
    expect(screen.getByTestId("pm-report-title")).toHaveTextContent("Week of 2 Nov");
    expect(screen.getByTestId("pm-report-changed")).toHaveTextContent("What changed this week");
    expect(screen.queryByTestId("pm-report-budget")).toBeNull();
    expect(screen.getByTestId("pm-report-review")).toHaveTextContent("Scores are up this week.");
    expect(screen.getByRole("button", { name: "Next week" })).toBeEnabled();
  });

  it("this week, before Monday's report: what changed so far and when the report comes", () => {
    renderAt("?view=reports&kind=weekly&period=2026-11-09");
    expect(screen.getByTestId("pm-report-kicker")).toHaveTextContent(
      "Weekly report · not written yet",
    );
    expect(screen.getByTestId("pm-report-title")).toHaveTextContent("Week of 9 Nov");
    expect(screen.getByTestId("pm-report-changed")).toBeInTheDocument();
    expect(screen.getByTestId("pm-report-review-pending")).toHaveTextContent(
      "The PM agent's report is written on Monday.",
    );
    expect(screen.getByRole("button", { name: "Next week" })).toBeDisabled();
  });

  it("says so when there are no reports yet", () => {
    h.reports.mockReturnValue(ok([]));
    renderAt("?view=reports");
    expect(screen.getByTestId("pm-reports-empty")).toHaveTextContent(
      "The PM agent hasn't written a report yet. Weekly reports appear after its first weekly run.",
    );
  });

  it("shows loading and errors as the other tabs do", () => {
    h.reports.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { unmount } = renderAt("?view=reports");
    expect(screen.getByTestId("pm-reports-loading")).toBeInTheDocument();
    unmount();

    const refetch = vi.fn();
    h.reports.mockReturnValue({ data: undefined, isError: true, error: { status: 500 }, refetch });
    const second = renderAt("?view=reports");
    expect(screen.getByTestId("pm-reports-error")).toBeInTheDocument();
    second.unmount();

    h.reports.mockReturnValue(ok(LIST));
    h.report.mockReturnValue({ data: undefined, isError: true, error: { status: 500 }, refetch });
    renderAt("?view=reports&kind=monthly&period=2026-10");
    expect(screen.getByTestId("pm-report-error")).toBeInTheDocument();
  });
});

describe("PM agent › Ideas: latest report", () => {
  it("links the latest weekly report and the latest monthly review", () => {
    renderAt("");
    const line = screen.getByTestId("pm-latest-report");
    // This week has no report yet, so the latest is the week of 2 Nov.
    expect(line).toHaveTextContent("Latest report: Week of 2 Nov · October review");
    expect(within(line).getByRole("link", { name: "Week of 2 Nov" })).toHaveAttribute(
      "href",
      "/debriefs/pm-agent?view=reports&kind=weekly&period=2026-11-02",
    );
    expect(within(line).getByRole("link", { name: "October review" })).toHaveAttribute(
      "href",
      "/debriefs/pm-agent?view=reports&kind=monthly&period=2026-10",
    );
  });

  it("shows only what exists", () => {
    h.reports.mockReturnValue(ok(LIST.filter(i => i.kind === "weekly")));
    const { unmount } = renderAt("");
    expect(screen.getByTestId("pm-latest-report")).toHaveTextContent(
      "Latest report: Week of 2 Nov",
    );
    expect(screen.getByTestId("pm-latest-report")).not.toHaveTextContent("review");
    unmount();
    h.reports.mockReturnValue(ok([]));
    renderAt("");
    expect(screen.queryByTestId("pm-latest-report")).toBeNull();
  });
});
