import React from "react";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Ratings & comments tab exists so a learner's own words can be read next
 * to the session they were about. What the tests hold:
 *
 * - a row shows its stars, the comment, who wrote it, where and about which
 *   roleplay, and links to the session only for an admin who can open it;
 * - a restricted admin reads the page's organisation and never gets the
 *   organisation picker or a link into the platform-only Roleplay Logs;
 * - the star buttons in the summary narrow the feed, and any narrowing goes
 *   back to page one;
 * - an empty feed says why it is empty.
 */

const ITEM = {
  feedbackId: "f1",
  sessionId: "11111111-2222-3333-4444-555555555555",
  sessionAt: "2026-10-16T10:00:00.000Z",
  ratedAt: "2026-10-16T10:05:00.000Z",
  rating: 2,
  comment: "The timer ended the roleplay before I could finish my plan.",
  tags: ["Lacking"],
  learnerId: 7,
  learnerName: "Asha Rao",
  tenantId: "org-1",
  orgName: "Riverside Clinic",
  scenarioId: 466,
  scenarioTitle: "Help a worried parent plan the next step",
  language: "English (India)",
};

const RESPONSE = {
  window: {
    from: "2026-07-25",
    to: "2026-10-22",
    label: "Last 90 days",
    days: 90,
    bucket: "week",
    allTime: false,
    inProgressBucket: "2026-10-19",
    computedAt: "2026-10-22T14:00:00.000Z",
  },
  summary: {
    ratings: 40,
    withComment: 12,
    avgRating: 3.9,
    distribution: [
      { rating: 1, count: 4, withComment: 3 },
      { rating: 2, count: 3, withComment: 2 },
      { rating: 3, count: 5, withComment: 2 },
      { rating: 4, count: 10, withComment: 2 },
      { rating: 5, count: 18, withComment: 3 },
    ],
  },
  items: [ITEM],
  total: 60,
  limit: 25,
  offset: 0,
  scoping: { tenantId: null, unscopedSections: [] },
  provenance: "",
};

let result: { data?: unknown; isLoading?: boolean; isFetching?: boolean; isError?: boolean } = {};
const querySpy = vi.fn();
let orgScope: { restricted: boolean; tenantId?: string } = { restricted: false };
let features: string[] = ["roleplay_session_logs"];

vi.mock("@api", () => ({
  useGetLearnerFeedbackQuery: (args: unknown) => {
    querySpy(args);
    return { ...result, refetch: vi.fn() };
  },
  useGetTenantsQuery: () => ({
    data: {
      data: [
        { id: "org-1", name: "Riverside Clinic", isTestOrganization: false },
        { id: "test-org", name: "Internal Testing", isTestOrganization: true },
      ],
    },
  }),
}));

vi.mock("react-redux", () => ({
  useSelector: (fn: (s: unknown) => unknown) => fn({ user: { features } }),
}));

vi.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }: any) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@constants", () => ({
  FeatureToggleKey: { ROLEPLAY_SESSION_LOGS: "roleplay_session_logs" },
  ROUTES: { ROLEPLAY_SESSION_LOG_DETAIL: (id: string) => `/roleplay-session-logs/${id}` },
}));

vi.mock("@utils", () => ({
  formatDate: (iso: string) => iso.slice(0, 10),
  hasFeature: (list: string[], key: string) => list.includes(key),
}));

vi.mock("@components", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@components/types", () => ({ ButtonVariant: { SECONDARY: "secondary" } }));

vi.mock("../../analyticsOrgScope", () => ({ useAnalyticsOrgScope: () => orgScope }));
vi.mock("../../tabControlsSlot", () => ({
  TabControls: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../chartKit", () => ({
  buildSource: () => "source",
  ChartCard: ({ title, empty, emptyText, loading, children }: any) => (
    <section aria-label={title}>
      {loading ? "loading" : empty ? <p>{emptyText}</p> : children}
    </section>
  ),
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  CarbonDropdown: ({ id, items }: any) => (
    <select data-testid={id}>
      {items.map((i: { id: string; label: string }) => (
        <option key={i.id}>{i.label}</option>
      ))}
    </select>
  ),
  CarbonToggle: ({ id, toggled, onToggle }: any) => (
    <input
      type="checkbox"
      data-testid={id}
      checked={toggled}
      onChange={e => onToggle(e.target.checked)}
    />
  ),
  MultiSelect: ({ id }: any) => <div data-testid={id} />,
  Search: ({ id, value, onChange }: any) => (
    <input data-testid={id} value={value} onChange={onChange} />
  ),
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Tile: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableHead: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
  TableCell: ({ children }: { children: React.ReactNode }) => <td>{children}</td>,
}));

const { RatingsCommentsTab, emptyFeedText, ratingTagType } = await import("../RatingsCommentsTab");

const renderTab = (query: Record<string, unknown> = { range: "90d" }) =>
  render(<RatingsCommentsTab query={query} language="" onSelectLanguage={() => undefined} />);

const lastArgs = () => querySpy.mock.calls[querySpy.mock.calls.length - 1][0];

describe("RatingsCommentsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    result = { data: RESPONSE, isLoading: false, isFetching: false };
    orgScope = { restricted: false };
    features = ["roleplay_session_logs"];
  });

  it("lists a comment with its stars, learner, organisation and roleplay", () => {
    renderTab();
    const feed = screen.getByRole("region", { name: "What learners wrote" });
    expect(within(feed).getByText(ITEM.comment)).toBeInTheDocument();
    expect(within(feed).getByText("2 out of 5")).toBeInTheDocument();
    expect(within(feed).getByText("Asha Rao")).toBeInTheDocument();
    expect(within(feed).getByText("Riverside Clinic")).toBeInTheDocument();
    expect(within(feed).getByText(ITEM.scenarioTitle)).toBeInTheDocument();
    expect(within(feed).getByText("Lacking")).toBeInTheDocument();
    expect(within(feed).getByText("Showing 1–1 of 60")).toBeInTheDocument();
  });

  it("links the date to the session for an admin who can open Roleplay Logs", () => {
    renderTab();
    expect(screen.getByRole("link", { name: "2026-10-16" })).toHaveAttribute(
      "href",
      `/roleplay-session-logs/${ITEM.sessionId}`,
    );
  });

  it("shows no link without the Roleplay Logs feature", () => {
    features = [];
    renderTab();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("2026-10-16")).toBeInTheDocument();
  });

  it("asks for commented ratings, page one, 25 at a time, by default", () => {
    renderTab();
    expect(lastArgs()).toMatchObject({
      range: "90d",
      tenantId: undefined,
      ratings: [],
      commentsOnly: true,
      limit: 25,
      offset: 0,
    });
  });

  it("offers only real organisations in the picker", () => {
    renderTab();
    const picker = screen.getByTestId("ratings-org");
    expect(within(picker).getByText("Riverside Clinic")).toBeInTheDocument();
    expect(within(picker).queryByText("Internal Testing")).not.toBeInTheDocument();
  });

  it("narrows a restricted admin to the page's organisation, with no picker and no link", () => {
    orgScope = { restricted: true, tenantId: "org-1" };
    renderTab({ range: "90d", tenantId: "org-1" });
    expect(lastArgs()).toMatchObject({ tenantId: "org-1" });
    expect(screen.queryByTestId("ratings-org")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // One organisation: the column would repeat the same name on every row.
    expect(screen.queryByRole("columnheader", { name: "Organisation" })).not.toBeInTheDocument();
  });

  it("narrows the feed to a star from the summary, and clears it on a second click", () => {
    renderTab();
    const star1 = screen.getByRole("button", { name: /^1 ★/ });
    fireEvent.click(star1);
    expect(lastArgs()).toMatchObject({ ratings: [1] });
    expect(star1).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(star1);
    expect(lastArgs()).toMatchObject({ ratings: [] });
  });

  it("pages forward, and goes back to page one when a filter changes", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(lastArgs()).toMatchObject({ offset: 25 });
    fireEvent.click(screen.getByRole("button", { name: /^5 ★/ }));
    expect(lastArgs()).toMatchObject({ ratings: [5], offset: 0 });
  });

  it("lists every rating when 'Only with a comment' is turned off", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("ratings-comments-only"));
    expect(lastArgs()).toMatchObject({ commentsOnly: false, offset: 0 });
  });

  it("says why the feed is empty", () => {
    result = {
      data: { ...RESPONSE, items: [], total: 0, summary: { ...RESPONSE.summary, withComment: 0 } },
    };
    renderTab();
    expect(screen.getByText(/No written comments in this period\. 40 ratings/)).toBeInTheDocument();
  });
});

describe("emptyFeedText", () => {
  const base = { commentsOnly: true, stars: [] as number[], search: "" };

  it("points at the time range when nothing was rated", () => {
    expect(emptyFeedText(undefined, base)).toMatch(/longer time range/);
  });

  it("blames the filters when the reader narrowed the feed", () => {
    expect(emptyFeedText(RESPONSE.summary, { ...base, stars: [3] })).toBe(
      "Nothing matches these filters.",
    );
    expect(emptyFeedText(RESPONSE.summary, { ...base, search: "audio" })).toBe(
      "Nothing matches these filters.",
    );
  });
});

describe("ratingTagType", () => {
  it("reads 1-2 as red, 3 as neutral, 4-5 as green", () => {
    expect([1, 2, 3, 4, 5].map(ratingTagType)).toEqual(["red", "red", "gray", "green", "green"]);
  });
});
