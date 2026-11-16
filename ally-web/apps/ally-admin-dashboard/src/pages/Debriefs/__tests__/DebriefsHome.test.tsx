import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  sessions: vi.fn(),
  home: vi.fn(),
  change: vi.fn(),
  conversation: vi.fn(),
  send: vi.fn(),
  settings: vi.fn(),
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
  useGetDebriefSessionsQuery: (q: unknown) => h.sessions(q),
  useGetDebriefHomeQuery: () => h.home(),
  useGetDebriefSettingsQuery: () => h.settings(),
  useGetDebriefChangeQuery: (id: string, opts?: { skip?: boolean }) =>
    opts?.skip ? { data: undefined } : h.change(id),
  useGetPmConversationQuery: () => h.conversation(),
  useLazyGetPmConversationQuery: () => [vi.fn(), { isFetching: false }],
  useSendPmMessageMutation: () => [h.send, { isLoading: false }],
}));

/* eslint-disable import/first */
import { redirectForOldTab } from "../consoleRoutes";
import { DebriefConsole } from "../DebriefConsole";
import { homeHeadline, scoreTrend } from "../home/DebriefsHome";
import { wordDiff } from "../home/NeedsYouItem";
import { ok, resolves } from "./consoleFixtures";
/* eslint-enable import/first */

const CAN = (on: boolean) =>
  Object.fromEntries(
    [
      "comment",
      "flagDecision",
      "heldDebrief",
      "escalate",
      "verdict",
      "score",
      "pmAgent",
      "approvePinnedRule",
      "testSets",
      "releases",
      "switchOrgOn",
      "emergencyStop",
      "ownerSettings",
    ].map(k => [k, on]),
  );
const TEAM = {
  roles: { allyTeam: true, clinicalAdvisor: false, owner: false, receivesEscalations: false },
  can: { ...CAN(true), verdict: false },
};
const ADVISOR = {
  roles: { allyTeam: false, clinicalAdvisor: true, owner: false, receivesEscalations: true },
  can: { ...CAN(false), comment: true, verdict: true, approvePinnedRule: true },
};

const item = (over: Record<string, unknown> = {}) => ({
  runId: "run-x",
  sessionId: "sess-x",
  scenario: { id: null, title: "Exam stress, first call" },
  tenantId: "t1",
  tenantName: "Sangath",
  language: "en",
  recipe: "standard",
  mode: "live",
  status: "published",
  skipReason: null,
  releaseVersion: 5,
  judgeOverall: 9.1,
  evaluatorOverall: 8.8,
  costUsd: 0.07,
  ceilingUsd: 0.5,
  seconds: 44,
  fallbackRung: 0,
  createdAt: new Date().toISOString(),
  rank: 3,
  needsPerson: true,
  urgent: true,
  flagged: false,
  flagCount: 0,
  importantMomentFlagged: false,
  escalated: false,
  riskCue: true,
  learnerDistress: false,
  belowBar: true,
  reviewed: false,
  waitingSince: null,
  ...over,
});

const ITEMS = [
  item({ runId: "a", scenario: { id: null, title: "Grief" }, flagged: true, judgeOverall: 6.4 }),
  item({ runId: "b", scenario: { id: null, title: "Workplace anxiety" } }),
];

const page = (items = ITEMS, viewer = TEAM) =>
  ok({
    category: "all",
    counts: { needs: 0, urgent: 0, flagged: 1, below: 0, published: 2, escalated: 0, all: 2 },
    items,
    filterOptions: {
      tenants: [{ id: "t1", name: "Sangath" }],
      languages: ["en", "hi"],
      recipes: ["standard"],
    },
    viewer,
  });

const HOME = {
  headline: { score: 7.8, lastWeekScore: 7.7, debriefs: 128, needsYou: 1 },
  needsYou: [
    {
      changeId: "c-safety",
      title: "Safety reader: name indirect self-harm cues",
      why: "Safety reader text always asks a person.",
    },
  ],
  thisWeek: {
    score: 7.8,
    wentLive: 1,
    undone: 1,
    changes: [
      { id: "c1", title: "Shorter “Work on this”", state: "live", result: "score +0.3" },
      { id: "c2", title: "Cheaper Writer", state: "undone", result: "Hindi −0.6" },
    ],
  },
};

const SAFETY = {
  id: "c-safety",
  title: "The Safety reader names a self-harm cue even when it is indirect.",
  kind: "Pinned rule · Safety reader",
  state: "waits",
  result: "It caught all 4 indirect cues that learners flagged this month.",
  why: "Learners flagged 4 debriefs.",
  when: "proposed 1 d ago",
  waitsBecause: "Safety reader text always asks a person.",
  confidence: "high",
  languages: null,
  measures: [],
  steps: [],
  basedOn: "Based on 4 learner flags and the safety set.",
  wording: {
    before: "A risk cue is a direct statement about harming oneself.",
    after: "A risk cue is a statement about harming oneself, direct or indirect.",
  },
  canUndo: false,
  canStop: false,
};

const Where = () => {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}${l.hash}`}</div>;
};

const renderAt = (path = "/debriefs") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/debriefs" element={<DebriefConsole />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.permissions = [];
  h.sessions.mockReturnValue(page());
  h.home.mockReturnValue(ok(HOME));
  h.settings.mockReturnValue(ok({ values: { undoMargin: 0.3 }, defaults: {}, spec: {} }));
  h.change.mockReturnValue(ok(SAFETY));
  h.conversation.mockReturnValue(
    ok({
      messages: [
        {
          id: "m1",
          at: "2026-11-16T09:00:00Z",
          who: "agent",
          author: null,
          text: "To confirm, I will put the new wording on 10% of learners. Reply yes.",
          about: { kind: "change", id: "c-safety", label: "Safety reader" },
          action: { label: "the new wording on 10%", status: "awaiting_yes" },
        },
        {
          id: "m2",
          at: "2026-11-16T09:01:00Z",
          who: "agent",
          author: null,
          text: "Shorter Work on this is live.",
          about: { kind: "page", id: "home", label: "Debriefs home" },
          action: null,
        },
      ],
      more: false,
    }),
  );
  h.send.mockReturnValue(resolves({ messages: [] }));
});

describe("Debriefs home (v2, U1): answer first", () => {
  it("a steady score is not named: “Debriefs are healthy this week, and 1 thing needs you.”", () => {
    renderAt();
    expect(screen.getByTestId("home-headline")).toHaveTextContent(
      "Debriefs are healthy this week, and 1 thing needs you.",
    );
    expect(screen.queryByTestId("home-headline-score")).toBeNull();
  });

  it("names the overall score only when it moved by more than the undo margin", () => {
    h.home.mockReturnValue(
      ok({ ...HOME, headline: { ...HOME.headline, score: 7.3, lastWeekScore: 7.7, needsYou: 0 } }),
    );
    renderAt();
    expect(screen.getByTestId("home-headline")).toHaveTextContent(
      "Overall score fell 0.4 this week; the change behind it was undone, and nothing needs you.",
    );
    const link = screen.getByTestId("home-headline-score");
    expect(link).toHaveAttribute("href", "/analytics?tab=debriefs");
    expect(link.getAttribute("title")).toMatch(/One score out of 10 from four measures/);
  });

  it("homeHeadline and scoreTrend", () => {
    const hd = (score: number | null, last: number | null) => ({
      score,
      lastWeekScore: last,
      debriefs: 1,
      needsYou: 0,
    });
    expect(homeHeadline(hd(7.8, 7.6), 0, 0.3).score).toBeNull();
    expect(homeHeadline(hd(8.2, 7.8), 0, 0.3).score).toEqual({
      dir: "rose",
      by: "0.4",
      undone: false,
    });
    expect(homeHeadline(hd(null, 7.8), 0, 0.3).noScore).toBe(true);
    expect(scoreTrend(7.8, 7.8)).toBe("steady");
    expect(scoreTrend(8.1, 7.8)).toBe("up 0.3");
    expect(scoreTrend(7.4, 7.8)).toBe("down 0.4");
  });

  it("This week and the PM agent are accordions, closed by default", () => {
    renderAt();
    const week = screen.getByTestId("home-this-week");
    expect(week.tagName).toBe("DETAILS");
    expect(week).not.toHaveAttribute("open");
    expect(within(week).getByText(/^This week:/)).toHaveTextContent(
      "This week: overall score 7.8 of 10, up 0.1 · 1 change went live, 1 was undone",
    );
    expect(within(week).getAllByTestId("home-week-change")[0]).toHaveTextContent(
      "Shorter “Work on this” · live for everyone · score +0.3",
    );
    const pm = screen.getByTestId("home-pm-accordion");
    expect(pm.tagName).toBe("DETAILS");
    expect(pm).not.toHaveAttribute("open");
    expect(pm).toHaveTextContent(
      "PM agent · it wants your view on Safety reader: name indirect self-harm cues",
    );
    expect(within(pm).getByTestId("pm-looking-at")).toHaveTextContent("Debriefs home");
  });

  it("the home conversation sends about the Debriefs home", async () => {
    renderAt();
    const pm = screen.getByTestId("home-pm");
    fireEvent.change(within(pm).getByLabelText("Message the PM agent"), {
      target: { value: "Hindi debriefs feel too formal" },
    });
    fireEvent.click(within(pm).getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(h.send).toHaveBeenCalledWith({
        text: "Hindi debriefs feel too formal",
        about: { kind: "page", id: "home", label: "Debriefs home" },
      }),
    );
  });
});

describe("Needs you: always-ask changes, handled on Home", () => {
  it("lists them closed, each a one-line row: Your call, the title, why it asks", () => {
    renderAt();
    const needs = screen.getByTestId("home-needs-you");
    expect(needs).toHaveTextContent("Needs you: one change the PM agent won’t make alone");
    const row = within(needs).getByTestId("home-needs-item");
    expect(row.tagName).toBe("DETAILS");
    expect(row).not.toHaveAttribute("open");
    expect(row).toHaveTextContent("Your call");
    expect(row).toHaveTextContent("Safety reader text always asks a person.");
    expect(screen.queryByTestId("needs-detail")).toBeNull();
    expect(h.change).not.toHaveBeenCalled();
  });

  it("?change=<id> opens that item expanded, with a scoped conversation", async () => {
    renderAt("/debriefs?change=c-safety");
    const detail = screen.getByTestId("needs-detail");
    expect(within(detail).getByTestId("needs-result")).toHaveTextContent(
      "It caught all 4 indirect cues",
    );
    const diff = within(detail).getByTestId("needs-diff");
    expect(diff.querySelector("del")).toHaveTextContent("direct");
    expect(diff.querySelector("ins")).toHaveTextContent(", direct or indirect.");
    expect(within(detail).getByTestId("needs-evidence")).toHaveTextContent(
      "Based on 4 learner flags",
    );
    const pm = within(detail).getByTestId("needs-pm-c-safety");
    expect(pm).toHaveTextContent("PM agent · about this change");
    // Only this change's messages, without "about".
    const msgs = within(pm).getAllByTestId("pm-message");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).not.toHaveTextContent("about");
    fireEvent.change(within(pm).getByLabelText("Reply to the PM agent about this change"), {
      target: { value: "yes" },
    });
    fireEvent.click(within(pm).getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(h.send).toHaveBeenCalledWith({
        text: "yes",
        about: {
          kind: "change",
          id: "c-safety",
          label: "Safety reader: name indirect self-harm cues",
        },
      }),
    );
  });

  it("a link to a change that no longer waits moves on to Changes", () => {
    renderAt("/debriefs?change=c-gone");
    expect(screen.getByTestId("where")).toHaveTextContent("/debriefs/pm-agent?change=c-gone");
  });

  it("wordDiff marks what was removed and added", () => {
    expect(wordDiff("a b c", "a x c")).toEqual([
      { text: "a ", kind: "same" },
      { text: "b", kind: "removed" },
      { text: "x", kind: "added" },
      { text: " c", kind: "same" },
    ]);
  });
});

describe("the clinical advisor's home", () => {
  beforeEach(() => {
    h.sessions.mockReturnValue(page(ITEMS, ADVISOR));
  });

  it("leads with their decision; no Changes, Analytics, Settings, This week or PM agent", () => {
    renderAt();
    expect(screen.getByTestId("home-headline")).toHaveTextContent("1 change needs your decision.");
    expect(screen.getByTestId("home-needs-you")).toHaveTextContent(
      "Needs you: a change only you or the owner can approve",
    );
    expect(screen.queryByTestId("changes-button")).toBeNull();
    expect(screen.queryByTestId("analytics-button")).toBeNull();
    expect(screen.queryByTestId("home-more")).toBeNull();
    expect(screen.queryByTestId("home-this-week")).toBeNull();
    expect(screen.queryByTestId("home-pm-accordion")).toBeNull();
  });

  it("a deep link opens their item on Home, never Changes", () => {
    renderAt("/debriefs?change=c-gone");
    expect(screen.queryByTestId("where")).toBeNull();
    expect(screen.getByTestId("debriefs-home")).toBeInTheDocument();
  });
});

describe("all debriefs by day", () => {
  it("no status or urgent pills, no Show dropdown: only ⚑ Flagged by the learner and the Quality score", () => {
    renderAt();
    expect(screen.queryByTestId("home-category")).toBeNull();
    const cards = screen.getAllByTestId("session-card");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByTestId("session-flag")).toHaveTextContent(
      "⚑ Flagged by the learner",
    );
    expect(within(cards[1]).queryByTestId("session-flag")).toBeNull();
    for (const word of ["Urgent", "Needs a person", "Below the bar", "Important moment"]) {
      expect(screen.getByTestId("home-list")).not.toHaveTextContent(word);
    }
    expect(cards[0]).toHaveTextContent("Quality score6.4");
    expect(cards[0]).not.toHaveTextContent("Cost");
    expect(screen.getByTestId("home-list")).toHaveTextContent("Today");
    expect(h.sessions).toHaveBeenLastCalledWith({ category: "all", limit: 50 });
  });

  it("j / k move the selection and Enter opens it", () => {
    renderAt();
    fireEvent.keyDown(window, { key: "j" });
    expect(screen.getAllByTestId("session-card")[1]).toHaveAttribute("data-selected", "true");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByTestId("where")).toHaveTextContent("/debriefs/sessions/b");
  });

  it("the list layout keeps the flag short", () => {
    renderAt("/debriefs?view=list");
    expect(
      within(screen.getAllByTestId("session-row")[0]).getByTestId("session-flag"),
    ).toHaveTextContent("⚑ Flagged");
  });
});

describe("rows never wrap", () => {
  it("Changes (with its needs-you count) and Analytics, Settings in More", () => {
    renderAt();
    const actions = screen.getByTestId("home-actions");
    const links = within(actions)
      .getAllByRole("link")
      .map(a => a.textContent);
    expect(links[0]).toMatch(/^Changes/);
    expect(links[1]).toMatch(/Analytics/);
    expect(screen.getByTestId("changes-needs-you")).toHaveTextContent("1");
    expect(within(actions).queryByRole("link", { name: "Settings" })).toBeNull();
    fireEvent.click(
      within(screen.getByTestId("home-more")).getByRole("button", { name: "More actions" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/debriefs/settings");
  });

  it("shows three filters, puts the rest behind More filters with a count, and chips every set one", () => {
    renderAt("/debriefs?language=hi&riskCue=true&cost=hit_ceiling");
    const bar = screen.getByTestId("home-filters");
    for (const id of ["org", "language", "recipe"]) {
      expect(within(bar).getByTestId(`home-filter-${id}`)).toBeInTheDocument();
    }
    expect(within(bar).queryByTestId("home-filter-risk")).toBeNull();
    expect(screen.getByTestId("home-more-filters-button-count")).toHaveTextContent("2");
    const chips = screen.getByTestId("home-chips");
    expect(chips).toHaveTextContent("Language: Hindi");
    fireEvent.click(
      within(chips).getByRole("button", { name: "Remove Risk cue: With a risk cue" }),
    );
    expect(h.sessions).toHaveBeenLastCalledWith({
      category: "all",
      language: "hi",
      cost: "hit_ceiling",
      limit: 50,
    });
    fireEvent.click(
      within(screen.getByTestId("home-chips")).getByRole("button", { name: "Clear all" }),
    );
    expect(h.sessions).toHaveBeenLastCalledWith({ category: "all", limit: 50 });
  });

  it("opens More filters on demand when nothing behind it is set", () => {
    renderAt();
    expect(screen.queryByTestId("home-more-filters")).toBeNull();
    fireEvent.click(screen.getByTestId("home-more-filters-button"));
    const more = screen.getByTestId("home-more-filters");
    for (const id of ["fallback", "risk", "cost"]) {
      expect(within(more).getByTestId(`home-filter-${id}`)).toBeInTheDocument();
    }
  });
});

describe("old links", () => {
  it.each([
    ["runs", "/debriefs"],
    ["review", "/debriefs"],
    ["pm-agent", "/debriefs/pm-agent"],
    ["releases", "/debriefs/pm-agent"],
    ["organisations", "/debriefs/settings#orgs"],
    ["settings", "/debriefs/settings"],
    ["knowledge", "/debriefs/settings#guidance"],
    ["calibration", "/analytics?tab=debriefs"],
    ["metrics", "/analytics?tab=debriefs"],
  ])("?tab=%s goes to %s", (tab, to) => {
    expect(redirectForOldTab(new URLSearchParams({ tab }))).toBe(to);
  });

  it("an expert review link opens that session", () => {
    expect(redirectForOldTab(new URLSearchParams({ tab: "expert-review", review: "r9" }))).toBe(
      "/debriefs/sessions/r9",
    );
  });

  it("follows the redirect when the page opens", () => {
    renderAt("/debriefs?tab=releases");
    expect(screen.getByTestId("where")).toHaveTextContent("/debriefs/pm-agent");
  });

  it("tells a reader without console access why (PE-02)", () => {
    h.sessions.mockReturnValue({
      data: undefined,
      isError: true,
      error: { status: 403 },
      refetch: vi.fn(),
    });
    renderAt();
    expect(screen.getByText(/can't open the Debriefs console/)).toBeInTheDocument();
  });

  it("says how many it shows of how many, and loads 50 more on request", () => {
    const many = Array.from({ length: 50 }, (_, i) => item({ runId: `r${i}` }));
    const p = page(many);
    p.data.counts.all = 120;
    h.sessions.mockReturnValue(p);
    renderAt();
    const more = screen.getByTestId("home-paging");
    expect(more).toHaveTextContent("Showing 50 of 120 debriefs");
    fireEvent.click(within(more).getByRole("button", { name: "Show 50 more" }));
    expect(h.sessions).toHaveBeenLastCalledWith({ category: "all", limit: 100 });
  });
});
