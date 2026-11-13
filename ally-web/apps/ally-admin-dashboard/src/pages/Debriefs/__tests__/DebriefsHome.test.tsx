import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  sessions: vi.fn(),
  attention: vi.fn(),
  escalate: vi.fn(),
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
  useGetDebriefAttentionQuery: () => h.attention(),
  useEscalateDebriefMutation: () => [h.escalate, { isLoading: false }],
}));

/* eslint-disable import/first */
import { redirectForOldTab } from "../consoleRoutes";
import { DebriefConsole } from "../DebriefConsole";
import { bannerHref, bannerText } from "../home/DebriefsHome";
import { CATEGORY_PARAM, categoriesFor, categoryCount, queueNoteFor, queueOrder } from "../queue";
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
const READER = {
  roles: { allyTeam: false, clinicalAdvisor: false, owner: false, receivesEscalations: false },
  can: CAN(false),
};
const ADVISOR = {
  roles: { allyTeam: false, clinicalAdvisor: true, owner: false, receivesEscalations: true },
  can: { ...CAN(false), comment: true, verdict: true },
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
  createdAt: "2026-11-12T08:00:00Z",
  rank: 3,
  needsPerson: false,
  urgent: false,
  flagged: false,
  flagCount: 0,
  importantMomentFlagged: false,
  escalated: false,
  riskCue: false,
  learnerDistress: false,
  belowBar: false,
  reviewed: false,
  waitingSince: null,
  ...over,
});

const QUEUE = [
  item({
    runId: "below",
    scenario: { id: null, title: "Workplace anxiety" },
    rank: 2,
    needsPerson: true,
    belowBar: true,
    status: "below_bar",
    waitingSince: "2026-11-12T06:00:00Z",
  }),
  item({
    runId: "urgent-new",
    scenario: { id: null, title: "Grief" },
    rank: 0,
    urgent: true,
    flagged: true,
    needsPerson: true,
    waitingSince: "2026-11-12T09:00:00Z",
  }),
  item({
    runId: "flag",
    scenario: { id: null, title: "Sleep problems" },
    rank: 1,
    flagged: true,
    needsPerson: true,
    waitingSince: "2026-11-12T05:00:00Z",
  }),
  item({
    runId: "urgent-old",
    scenario: { id: null, title: "Self-harm disclosure" },
    rank: 0,
    urgent: true,
    flagged: true,
    needsPerson: true,
    waitingSince: "2026-11-12T04:00:00Z",
  }),
];

const page = (items = QUEUE, viewer = TEAM) =>
  ok({
    category: "needs",
    counts: {
      needs: 4,
      urgent: 2,
      flagged: 2,
      below: 1,
      published: 120,
      escalated: 0,
      all: 142,
    },
    items,
    filterOptions: {
      tenants: [{ id: "t1", name: "Sangath" }],
      languages: ["en", "hi"],
      recipes: ["standard"],
    },
    viewer,
  });

const attention = (viewer = TEAM, banners: unknown[] = []) =>
  ok({
    banners,
    counts: { urgent: 2, oldestUrgentSince: null, escalatedToMe: null, pmAgentNeedsYou: 3 },
    viewer,
  });

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
  h.sessions.mockReturnValue(page());
  h.attention.mockReturnValue(attention());
  h.escalate.mockReturnValue(resolves());
});

describe("queue order", () => {
  it("tells a reader without console access why, in the Debriefs console's words (PE-02)", () => {
    h.sessions.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: { status: 403, data: { message: "Missing required permissions" } },
      refetch: vi.fn(),
    });
    renderAt();
    expect(screen.getByTestId("ally-forbidden")).toHaveTextContent("Debriefs console");
    expect(screen.getByTestId("ally-forbidden")).not.toHaveTextContent("Ally guide");
  });

  it("puts urgent before other flags before below the bar, the longest wait first", () => {
    expect(queueOrder(QUEUE as never).map(i => i.runId)).toEqual([
      "urgent-old",
      "urgent-new",
      "flag",
      "below",
    ]);
  });
});

describe("Agreement sample category", () => {
  it("shows only to whoever gives verdicts, and reads ally-be's agreement_sample", () => {
    expect(categoriesFor({ score: false, escalations: true, verdict: true })).toContain(
      "agreement",
    );
    expect(categoriesFor({ score: true, escalations: true, verdict: false })).not.toContain(
      "agreement",
    );
    expect(CATEGORY_PARAM.agreement).toBe("agreement_sample");
    expect(categoryCount({ agreementSample: 3 } as never, "agreement")).toBe(3);
  });
});

describe("Debriefs home", () => {
  it("lists Needs a person in queue order, with the counts ally-be sends", () => {
    renderAt();
    expect(h.sessions).toHaveBeenCalledWith({ category: "needs" });
    const cards = screen.getAllByTestId("session-card");
    expect(cards.map(c => c.dataset.run)).toEqual(["urgent-old", "urgent-new", "flag", "below"]);
    expect(cards[0]).toHaveTextContent("Urgent");
    expect(screen.getByRole("option", { name: "Needs a person (4)" })).toBeInTheDocument();
    expect(screen.getByText(/Most urgent first/)).toBeInTheDocument();
    // A session link keeps the category so Back and Previous / Next agree.
    expect(cards[0]).toHaveAttribute("href", "/debriefs/sessions/urgent-old");
  });

  it("other categories group by day, newest first, and ask ally-be for the filters", () => {
    renderAt("/debriefs?cat=published&language=hi&riskCue=true");
    expect(h.sessions).toHaveBeenCalledWith({
      category: "published",
      language: "hi",
      riskCue: "true",
    });
    expect(screen.queryByText(/Most urgent first/)).toBeNull();
  });

  it("j / k move the selection and Enter opens it", () => {
    renderAt();
    fireEvent.keyDown(window, { key: "j" });
    expect(screen.getAllByTestId("session-card")[1]).toHaveAttribute("data-selected", "true");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByTestId("where")).toHaveTextContent("/debriefs/sessions/urgent-new");
  });

  it("e escalates the selected item for the Ally team", async () => {
    renderAt();
    fireEvent.keyDown(window, { key: "e" });
    await waitFor(() =>
      expect(h.escalate).toHaveBeenCalledWith({ kind: "runs", id: "urgent-old" }),
    );
  });

  it("shows the banners ally-be sends; each links to what to read, never acts", () => {
    h.attention.mockReturnValue(
      attention(TEAM, [
        {
          kind: "urgent",
          level: "red",
          count: 2,
          oldestSince: null,
          message: "x",
          link: { page: "session", runId: "urgent-old" },
        },
        { kind: "cap", level: "yellow", message: "x", link: { page: "settings" } },
      ]),
    );
    renderAt();
    const urgent = screen.getByTestId("home-banner-urgent");
    expect(urgent).toHaveAttribute("role", "alert");
    expect(within(urgent).getByRole("link", { name: "Open it" })).toHaveAttribute(
      "href",
      "/debriefs/sessions/urgent-old",
    );
    expect(screen.getByTestId("home-banner-cap")).toHaveAttribute("role", "status");
    expect(screen.getByTestId("pm-needs-you")).toHaveTextContent("3");
  });

  it("puts Analytics before PM agent, linking to Analytics › Debriefs", () => {
    h.attention.mockReturnValue(attention(TEAM, []));
    renderAt();
    const analytics = screen.getByTestId("analytics-button");
    expect(analytics).toHaveTextContent("Analytics");
    expect(analytics).toHaveAttribute("href", "/analytics?tab=debriefs");
    expect(
      analytics.compareDocumentPosition(screen.getByTestId("pm-agent-button")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides To score, the ! badge and e for someone who doesn't score or escalate", () => {
    h.sessions.mockReturnValue(page(QUEUE, READER));
    h.attention.mockReturnValue(attention(READER));
    renderAt();
    expect(screen.queryByRole("button", { name: /To score/ })).toBeNull();
    expect(screen.queryByTestId("to-score-badge")).toBeNull();
    expect(screen.getByTestId("home-keys")).toHaveTextContent("j / k move · Enter open");
    fireEvent.keyDown(window, { key: "e" });
    expect(h.escalate).not.toHaveBeenCalled();
  });

  it("gives the clinical advisor no To score (Score by hand is gone), and plain column names", () => {
    h.sessions.mockReturnValue(page(QUEUE, ADVISOR));
    h.attention.mockReturnValue(attention(ADVISOR));
    renderAt();
    expect(screen.queryByRole("option", { name: /To score/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Escalated to you/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Agreement sample/ })).toBeInTheDocument();
    expect(screen.queryByTestId("to-score-badge")).toBeNull();
    const card = screen.getAllByTestId("session-card")[0];
    expect(card).toHaveTextContent("Independent check");
    expect(card).toHaveTextContent("Ally’s own check");
    expect(card).not.toHaveTextContent("Evaluator");
  });

  it("gives the clinical advisor no Below the bar until their verdict; the Ally team keeps it", () => {
    // ally-be reads a below-the-bar run as published for the advisor (status, belowBar, rank).
    const blinded = item({ runId: "blind", status: "published", belowBar: false });
    const blindPage = page([blinded], ADVISOR) as { data: { counts: Record<string, unknown> } };
    blindPage.data.counts = { ...blindPage.data.counts, below: null };
    h.sessions.mockReturnValue(blindPage);
    h.attention.mockReturnValue(attention(ADVISOR));
    const { unmount } = renderAt("/debriefs?cat=below");
    expect(screen.queryByRole("option", { name: /Below the bar/ })).toBeNull();
    // A link to the Below the bar list falls back to the advisor's own default.
    expect(h.sessions).not.toHaveBeenCalledWith(expect.objectContaining({ category: "below" }));
    expect(screen.getAllByTestId("session-card")[0]).not.toHaveTextContent("Below the bar");
    expect(categoriesFor({ escalations: true, verdict: true, team: false })).not.toContain("below");
    unmount();

    h.sessions.mockReturnValue(page(QUEUE, TEAM));
    h.attention.mockReturnValue(attention(TEAM));
    renderAt();
    expect(screen.getByRole("option", { name: /Below the bar/ })).toBeInTheDocument();
    expect(categoriesFor({ escalations: false, team: true })).toContain("below");
  });
});

describe("the queue note says nothing of the checks to the clinical advisor", () => {
  const BELOW = /below the bar/i;

  it("the advisor's escalations: escalated flags, then the rest", () => {
    const escalated = item({ runId: "esc", escalated: true, rank: 1, needsPerson: true });
    h.sessions.mockReturnValue(page([escalated], ADVISOR));
    h.attention.mockReturnValue(attention(ADVISOR));
    renderAt("/debriefs?cat=escalated");
    expect(screen.getByTestId("queue-note")).toHaveTextContent(
      "Most urgent first: escalated flags, then the rest.",
    );
    expect(screen.queryByText(BELOW)).toBeNull();
  });

  it("the advisor's Needs a person: flags, then held debriefs, never below the bar", () => {
    h.sessions.mockReturnValue(
      page([item({ runId: "held", rank: 2, status: "needs_person" })], ADVISOR),
    );
    h.attention.mockReturnValue(attention(ADVISOR));
    renderAt("/debriefs?cat=needs");
    expect(screen.getByTestId("queue-note")).toHaveTextContent(
      "Most urgent first: important-moment flags, then other flags, then held debriefs.",
    );
    expect(screen.queryByText(BELOW)).toBeNull();
  });

  it("an empty queue has no note, and its empty state names no bar for the advisor", () => {
    h.sessions.mockReturnValue(page([], ADVISOR));
    h.attention.mockReturnValue(attention(ADVISOR));
    renderAt("/debriefs?cat=needs");
    expect(screen.queryByTestId("queue-note")).toBeNull();
    expect(screen.getByText("Nothing needs a person")).toBeInTheDocument();
    expect(screen.queryByText(BELOW)).toBeNull();
  });

  it("the Ally team keeps the full note", () => {
    h.sessions.mockReturnValue(page(QUEUE, TEAM));
    h.attention.mockReturnValue(attention(TEAM));
    renderAt("/debriefs?cat=needs");
    expect(screen.getByTestId("queue-note")).toHaveTextContent(
      "Most urgent first: important-moment flags, then other flags, then debriefs below the bar.",
    );
  });

  it("queueNoteFor: no note outside a queue", () => {
    const notes = { team: "T", blind: { needs: "N", escalated: "E" } };
    expect(queueNoteFor("published", false, notes)).toBeNull();
    expect(queueNoteFor("needs", false, notes)).toBe("T");
    expect(queueNoteFor("needs", true, notes)).toBe("N");
    expect(queueNoteFor("escalated", true, notes)).toBe("E");
  });
});

describe("old ?tab= links", () => {
  it.each([
    ["runs", "/debriefs?cat=all"],
    ["review", "/debriefs?cat=needs"],
    ["pm-agent", "/debriefs/pm-agent"],
    ["releases", "/debriefs/pm-agent?view=releases"],
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
    expect(screen.getByTestId("where")).toHaveTextContent("/debriefs/pm-agent?view=releases");
  });
});

describe("release waiting banner", () => {
  it("says a release would undo a promoted change and links to Releases", () => {
    const b = {
      kind: "release_waiting",
      level: "red",
      count: 2,
      message: "x",
      link: { page: "pm_agent" },
    } as never;
    expect(bannerText(b)).toContain("2 Skills Store or code releases are waiting");
    expect(bannerHref(b)).toBe("/debriefs/pm-agent?view=releases");
  });
});
