import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  changes: vi.fn(),
  change: vi.fn(),
  home: vi.fn(),
  conversation: vi.fn(),
  send: vi.fn(),
  undo: vi.fn(),
  stop: vi.fn(),
  approve: vi.fn(() => ({ unwrap: () => Promise.resolve({}) })),
  turnDown: vi.fn(() => ({ unwrap: () => Promise.resolve({}) })),
  me: vi.fn(),
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
  useGetDebriefMeQuery: () => h.me(),
  useGetDebriefOverviewQuery: () => ({ data: undefined }),
  useBuildDebriefTestSetsMutation: () => [vi.fn(), { isLoading: false }],
  useGetPmAgentReportsQuery: () => ({ data: [] }),
  useGetPmAgentReportQuery: () => ({ data: undefined }),
  useGetDebriefChangesQuery: () => h.changes(),
  useGetDebriefChangeQuery: (id: string, opts?: { skip?: boolean }) =>
    opts?.skip ? { data: undefined } : h.change(id),
  useGetDebriefHomeQuery: () => h.home(),
  useUndoDebriefChangeMutation: () => [h.undo, { isLoading: false }],
  useStopDebriefChangeMutation: () => [h.stop, { isLoading: false }],
  useGetPmConversationQuery: () => h.conversation(),
  useLazyGetPmConversationQuery: () => [vi.fn(), { isFetching: false }],
  useSendPmMessageMutation: () => [h.send, { isLoading: false }],
  useApproveDebriefChangeMutation: () => [h.approve, { isLoading: false }],
  useTurnDownDebriefChangeMutation: () => [h.turnDown, { isLoading: false }],
}));

/* eslint-disable import/first */
import { groupOf, visibleChanges } from "../pm/ChangesView";
import { PmAgentPage } from "../pm/PmAgentPage";
import { ADVISOR_PERMS, OWNER_PERMS, ok, resolves, TEAM_PERMS } from "./consoleFixtures";
import { debriefAccessFor } from "../debriefAccess";
/* eslint-enable import/first */

const change = (over: Record<string, unknown> = {}) => ({
  id: "c-live",
  title: "“Work on this” cards are at most two sentences.",
  kind: "Prompt · Writer",
  state: "live",
  result: "Shorter “Work on this” raised the score by 0.3",
  why: "Learners said the cards were too long to act on.",
  when: "live since 12 Nov",
  waitsBecause: null,
  confidence: "high",
  languages: null,
  measures: [
    { name: "Score", value: "+0.3", tone: "up" },
    { name: "Cost", value: "no change", tone: "flat" },
  ],
  steps: [
    { name: "Tested", state: "Passed", detail: "Test sets", tone: "pass" },
    { name: "Watched", state: "Day 4 of 14", detail: "Undone if the score drops", tone: "wait" },
  ],
  basedOn: "Based on: 11 learner comments.",
  canUndo: true,
  canStop: false,
  ...over,
});

const ALL = [
  change(),
  change({
    id: "c-safety",
    title: "Safety reader: indirect self-harm cues",
    kind: "Prompt · Safety reader",
    state: "waits",
    result: "Catches every indirect cue on the test sets",
    waitsBecause: "Safety reader text always asks a person.",
    canUndo: false,
  }),
  change({
    id: "c-try",
    title: "Practise next names the scenario",
    state: "trying",
    canUndo: false,
    canStop: true,
    languages: ["hi"],
  }),
  change({
    id: "c-build",
    title: "Analyst reads the voice-note",
    state: "building",
    canUndo: false,
  }),
  change({ id: "c-undone", title: "Writer on a cheaper model", state: "undone", canUndo: false }),
  change({ id: "c-test", title: "Being tested", state: "testing", canUndo: false, canStop: true }),
];

const MESSAGES = [
  {
    id: "m1",
    at: "2026-11-15T10:00:00Z",
    who: "agent",
    author: null,
    text: "I undid the cheaper Writer: Hindi fell 0.6.",
    about: { kind: "change", id: "c-undone", label: "Writer on a cheaper model" },
    action: { label: "undone automatically", status: "done" },
  },
  {
    id: "m2",
    at: "2026-11-15T10:01:00Z",
    who: "person",
    author: "Gopi",
    text: "Approve the safety change",
    about: { kind: "change", id: "c-safety", label: "Safety reader: indirect self-harm cues" },
    action: null,
  },
  {
    id: "m3",
    at: "2026-11-15T10:01:20Z",
    who: "agent",
    author: null,
    text: "To confirm, I will put it on 10% of learners. Reply yes to go ahead.",
    about: { kind: "change", id: "c-safety", label: "Safety reader: indirect self-harm cues" },
    action: { label: "the Safety reader on 10% of learners", status: "awaiting_yes" },
  },
];

const Where = () => {
  const l = useLocation();
  return <div data-testid="where">{l.search}</div>;
};

const renderAt = (search = "") =>
  render(
    <MemoryRouter initialEntries={[`/debriefs/changes${search}`]}>
      <PmAgentPage />
      <Where />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.permissions = TEAM_PERMS;
  h.me.mockReturnValue({ data: undefined });
  h.changes.mockReturnValue(ok(ALL));
  h.change.mockImplementation((id: string) => ok(ALL.find(c => c.id === id)));
  h.home.mockReturnValue(
    ok({
      headline: { score: 7.8, lastWeekScore: 7.8, debriefs: 128, needsYou: 1 },
      needsYou: [],
      thisWeek: { score: 7.8, wentLive: 1, undone: 1, changes: [] },
    }),
  );
  h.conversation.mockReturnValue(ok({ messages: MESSAGES, more: false }));
  h.send.mockReturnValue(resolves({ messages: [] }));
  h.undo.mockReturnValue(resolves(change({ state: "undone" })));
  h.stop.mockReturnValue(resolves(change({ state: "stopped" })));
});

describe("Changes (v2, U3)", () => {
  it("groups changes: Waits for you, On some learners, Being tested, Being built, Live, Undone", () => {
    renderAt();
    const list = screen.getByTestId("changes-list");
    const headings = within(list)
      .getAllByRole("heading", { level: 2 })
      .map(h2 => h2.textContent);
    expect(headings).toEqual([
      "Waits for you1",
      "On some learners1",
      "Being tested1",
      "Being built1",
      "Live1",
      "Undone1",
    ]);
    expect(screen.getByTestId("changes-headline")).toHaveTextContent(
      "The Debrief PM agent is improving debriefs on its own: one change went live this week, one is being tried, and one waits for you.",
    );
  });

  it("This week sits under the headline: the score, its trend, what went live or was undone", () => {
    renderAt();
    expect(screen.getByTestId("changes-this-week")).toHaveTextContent(/^This week: /);
  });

  it("groupOf: testing and not-yet-tested have their own groups; stopped and turned down with Undone", () => {
    expect(groupOf("testing")).toBe("testing");
    expect(groupOf("proposed")).toBe("proposed");
    expect(groupOf("stopped")).toBe("undone");
    expect(groupOf("turned_down")).toBe("undone");
  });

  it("opens the first change that waits: its title and why it waits", () => {
    renderAt();
    const detail = screen.getByTestId("change-detail");
    expect(within(detail).getByRole("heading", { level: 2 })).toHaveTextContent(
      "Safety reader: indirect self-harm cues",
    );
    expect(screen.getByTestId("change-state")).toHaveTextContent("Waits for you");
    expect(screen.getByTestId("change-waits-note")).toHaveTextContent(
      "Safety reader text always asks a person.",
    );
    // The team decides a change that waits for a person.
    expect(within(detail).getByTestId("decision-buttons")).toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: "Undo now" })).toBeNull();
    expect(within(detail).queryByRole("button", { name: "Stop now" })).toBeNull();
  });

  it("the owner decides with buttons right after the change, outside the conversation", async () => {
    h.permissions = [...TEAM_PERMS, ...OWNER_PERMS];
    renderAt();
    const decide = within(screen.getByTestId("change-detail")).getByTestId("decision-buttons");
    expect(within(screen.getByTestId("changes-pm")).queryByTestId("decision-buttons")).toBeNull();
    fireEvent.click(within(decide).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(h.approve).toHaveBeenCalledWith({ id: "c-safety" }));
  });

  it("Undo now on a live change undoes it at once", async () => {
    renderAt("?change=c-live");
    const detail = screen.getByTestId("change-detail");
    expect(within(detail).getByTestId("change-measures")).toHaveTextContent("Score+0.3");
    expect(within(detail).getByTestId("change-steps")).toHaveTextContent("WatchedDay 4 of 14");
    fireEvent.click(within(detail).getByRole("button", { name: "Undo now" }));
    await waitFor(() => expect(h.undo).toHaveBeenCalledWith("c-live"));
    expect(within(detail).queryByRole("button", { name: "Stop now" })).toBeNull();
  });

  it("Stop now on a change being tried stops it; its languages and confidence show", async () => {
    renderAt("?change=c-try");
    const detail = screen.getByTestId("change-detail");
    expect(detail).toHaveTextContent("Only Hindi");
    expect(detail).toHaveTextContent("High confidence");
    fireEvent.click(within(detail).getByRole("button", { name: "Stop now" }));
    await waitFor(() => expect(h.stop).toHaveBeenCalledWith("c-try"));
    expect(within(detail).queryByRole("button", { name: "Undo now" })).toBeNull();
  });

  it("picking a change puts it in the URL; an old ?idea= link still opens it", () => {
    renderAt("?idea=c-build");
    expect(screen.getByTestId("change-detail")).toHaveTextContent("Analyst reads the voice-note");
    fireEvent.click(screen.getByRole("button", { name: /Writer on a cheaper model/ }));
    expect(screen.getByTestId("where").textContent).toBe("?change=c-undone");
  });

  it("has no Run the Debrief PM agent now button", () => {
    renderAt();
    expect(screen.queryByRole("button", { name: "Run the Debrief PM agent now" })).toBeNull();
  });
});

describe("the Debrief PM agent conversation beside Changes", () => {
  it("All messages shows the one thread: who, what each message was about, and each action's status", () => {
    renderAt();
    fireEvent.click(screen.getByTestId("changes-pm-scope"));
    const pm = screen.getByTestId("changes-pm");
    const msgs = within(pm).getAllByTestId("pm-message");
    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toHaveTextContent("Debrief PM agent · about Writer on a cheaper model");
    expect(msgs[1]).toHaveTextContent("Gopi · about Safety reader: indirect self-harm cues");
    const actions = within(pm).getAllByTestId("pm-message-action");
    expect(actions[0]).toHaveTextContent("Done: undone automatically");
    expect(actions[1]).toHaveTextContent(
      "Waiting for your yes: the Safety reader on 10% of learners",
    );
    expect(actions[1]).toHaveAttribute("data-status", "awaiting_yes");
  });

  it("the conversation is this change's own, and Send passes it as about", async () => {
    renderAt("?change=c-live");
    const pm = screen.getByTestId("changes-pm");
    expect(within(pm).getByTestId("pm-looking-at")).toHaveTextContent(
      "“Work on this” cards are at most two sentences.",
    );
    fireEvent.change(within(pm).getByLabelText("Reply to the Debrief PM agent about this change"), {
      target: { value: "Undo it for Tamil only" },
    });
    fireEvent.click(within(pm).getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(h.send).toHaveBeenCalledWith({
        text: "Undo it for Tamil only",
        about: {
          kind: "change",
          id: "c-live",
          label: "“Work on this” cards are at most two sentences.",
        },
      }),
    );
  });

  it("a suggestion sends its words about the selected change", async () => {
    renderAt("?change=c-undone");
    const pm = screen.getByTestId("changes-pm");
    fireEvent.click(within(pm).getByRole("button", { name: "Try it again for one language" }));
    await waitFor(() =>
      expect(h.send).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Try it again for one language",
          about: expect.objectContaining({ kind: "change", id: "c-undone" }),
        }),
      ),
    );
  });

  it("says so when the thread is empty", () => {
    h.conversation.mockReturnValue(ok({ messages: [], more: false }));
    renderAt();
    expect(screen.getByTestId("pm-thread-empty")).toBeInTheDocument();
  });
});

describe("who sees which changes", () => {
  it("only the team and the owner see changes; the clinical advisor sees none", () => {
    const advisor = debriefAccessFor(["review:admin:debriefs"]);
    expect(visibleChanges(ALL as never, advisor)).toHaveLength(0);
    const team = debriefAccessFor(TEAM_PERMS);
    expect(visibleChanges(ALL as never, team)).toHaveLength(ALL.length);
    expect(visibleChanges(ALL as never, debriefAccessFor([]))).toHaveLength(0);
  });

  it("Undo now and Stop now need the releases permission", () => {
    const can = Object.fromEntries(
      [
        "comment",
        "flagDecision",
        "heldDebrief",
        "escalate",
        "verdict",
        "pmAgent",
        "testSets",
        "releases",
        "switchOrgOn",
        "emergencyStop",
        "ownerSettings",
      ].map(k => [k, k === "pmAgent"]),
    );
    h.me.mockReturnValue({
      data: {
        userId: 1,
        roles: {
          allyTeam: false,
          clinicalAdvisor: false,
          owner: false,
          receivesEscalations: false,
        },
        can,
      },
    });
    renderAt("?change=c-live");
    expect(screen.getByTestId("change-detail")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo now" })).toBeNull();
  });

  it("the clinical advisor gets their changes only: no Reports or Test sets, even by link", () => {
    h.permissions = ADVISOR_PERMS;
    renderAt("?view=reports");
    expect(screen.queryByRole("link", { name: "Reports" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Test sets" })).toBeNull();
    expect(screen.queryByText("Safety reader: indirect self-harm cues")).toBeNull();
    expect(screen.queryByText("Writer on a cheaper model")).toBeNull();
  });

  it("someone without the Debrief PM agent gets no conversation", () => {
    h.permissions = [];
    renderAt();
    expect(screen.queryByTestId("changes-pm")).toBeNull();
  });
});
