import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  session: vi.fn(),
  act: vi.fn(),
  resolve: vi.fn(),
  correct: vi.fn(),
  escalate: vi.fn(),
  add: vi.fn(),
  verdict: vi.fn(),
  status: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("react-redux", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSelector: (pick: (state: unknown) => unknown) => pick({ user: { permissions: [] } }),
}));
vi.mock("@api", async importOriginal => {
  const { ok, MODELS } = await import("./consoleFixtures");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useGetDebriefSessionQuery: () => h.session(),
    useGetDebriefModelsQuery: () => ok(MODELS),
    useActOnDebriefRunMutation: () => [h.act, { isLoading: false }],
    useResolveDebriefFlagMutation: () => [h.resolve, { isLoading: false }],
    useCorrectDebriefRunMutation: () => [h.correct, { isLoading: false }],
    useEscalateDebriefMutation: () => [h.escalate, { isLoading: false }],
    useAddDebriefCommentMutation: () => [h.add, { isLoading: false }],
    useEditDebriefCommentMutation: () => [vi.fn(), { isLoading: false }],
    useDeleteDebriefCommentMutation: () => [vi.fn(), { isLoading: false }],
    useSetDebriefCommentStatusMutation: () => [h.status, { isLoading: false }],
    useSetExpertVerdictMutation: () => [h.verdict, { isLoading: false }],
    useGetMyExpertCommentsQuery: () => ok({ items: [] }),
    useMarkStillHappeningMutation: () => [vi.fn(), { isLoading: false }],
  };
});

/* eslint-disable import/first */
import { DebriefSessionPage } from "../session/DebriefSessionPage";
import { ok, resolves } from "./consoleFixtures";
/* eslint-enable import/first */

const CARDS = {
  opening: "You stayed calm when she said she couldn't cope.",
  important_moment: null,
  what_worked: [],
  work_on_this: [
    {
      skill: "Asking about safety",
      turn_index: 2,
      quote: "Maybe we can make a timetable?",
      lead: "Ask about safety",
      why: "It keeps them safe.",
      try_saying: "Are you safe?",
    },
  ],
  reflective_question: "What stopped you from asking?",
};

const comment = {
  id: "c1",
  runId: "run-1",
  parentId: null,
  anchorKind: "transcript",
  turnIndex: 2,
  section: null,
  spanStart: 0,
  spanEnd: 5,
  quotedText: "Maybe",
  body: "She should have paused here.",
  tag: "missed_moment",
  status: "open",
  reviewer: { id: 7, name: "Dr. Mehta" },
  mine: false,
  createdAt: "2026-11-12T10:00:00Z",
  updatedAt: "2026-11-12T10:00:00Z",
  resolvedAt: null,
  idea: null,
  repeatOf: null,
};

const CAN_ALL = {
  comment: true,
  flagDecision: true,
  heldDebrief: true,
  escalate: true,
  verdict: false,
  score: false,
  pmAgent: true,
  approvePinnedRule: false,
  testSets: true,
  releases: true,
  switchOrgOn: false,
  emergencyStop: true,
  ownerSettings: false,
};
const TEAM_VIEWER = {
  roles: { allyTeam: true, clinicalAdvisor: false, owner: false, receivesEscalations: false },
  can: CAN_ALL,
  scorer: false,
};
const NOBODY = {
  roles: { allyTeam: false, clinicalAdvisor: false, owner: false, receivesEscalations: false },
  can: Object.fromEntries(Object.keys(CAN_ALL).map(k => [k, false])),
  scorer: false,
};
const ADVISOR = {
  roles: { allyTeam: false, clinicalAdvisor: true, owner: false, receivesEscalations: true },
  can: {
    ...NOBODY.can,
    comment: true,
    flagDecision: true,
    verdict: true,
    score: true,
    approvePinnedRule: true,
  },
  scorer: true,
};

const FLAG = {
  id: "flag-1",
  section: "work_on_this[0]",
  reason: "advice_doesnt_fit",
  note: "She never said anything about harming herself.",
  urgent: true,
  status: "open",
  createdAt: "2026-11-12T09:00:00Z",
  inUndoWindow: false,
  resolutionNote: null,
  resolvedAt: null,
  resolvedBy: null,
  cardText: "Ask about safety.",
  card: { lead: "Ask about safety", why: "It keeps them safe.", try_saying: "Are you safe?" },
  turns: [1, 2],
  canDecide: true,
};

const TEAM_PENDING = [
  {
    kind: "urgent_flag",
    level: "red",
    waitingSince: "2026-11-12T09:00:00Z",
    overdue: false,
    title: "The learner flagged Work on this.",
    flagId: "flag-1",
    anchors: { turns: [1, 2], cardSection: "work_on_this[0]", learnerNote: "She never…" },
    decisions: ["correct", "keep", "remove", "escalate"],
  },
  {
    kind: "held",
    level: "yellow",
    waitingSince: "2026-11-12T08:00:00Z",
    overdue: false,
    title: "Held below the bar.",
    anchors: { turns: [1], judgeReasons: true },
    decisions: ["publish", "todays_debrief", "correct", "escalate"],
  },
];

const view = (over: Record<string, unknown> = {}) => ({
  run: {
    id: "run-1",
    sessionId: "sess-1",
    mode: "live",
    status: "needs_person",
    skipReason: null,
    language: "en",
    languageSource: null,
    recipe: "standard",
    releaseVersion: 5,
    createdAt: "2026-11-12T08:00:00Z",
    hasRiskCue: true,
    learnerDistress: false,
    openedByLearnerAt: null,
  },
  session: {
    id: "sess-1",
    scenario: { id: "sc1", title: "Exam stress, first call" },
    learner: { id: 9, name: "Asha", level: "new" },
    tenantId: "t1",
    tenantName: "Sangath",
    startedAt: null,
    endedAt: null,
    turns: 2,
  },
  transcript: [
    {
      turnIndex: 1,
      speaker: "client",
      text: "Honestly, what's even the point.",
      gap: false,
      riskCue: { category: "hopelessness", learnerResponse: "moved_on" },
    },
    {
      turnIndex: 2,
      speaker: "learner",
      text: "Maybe we can make a timetable?",
      gap: false,
      riskCue: null,
    },
  ],
  cards: CARDS,
  cardVersion: 1,
  versions: [],
  corrections: [],
  flags: [FLAG],
  askAlly: { exchanges: [], totalCostUsd: null, distressItems: [] },
  learnerDistress: { present: false, inSession: false, inAskAlly: false, riskCueTurns: [1] },
  skillEstimate: {
    progress: [{ skill: "Asking about safety", trend: "too_early" }],
    skillWords: [{ skill: "Asking about safety", word: "keep_practising" }],
    learnerLevel: "new",
    pastSessions: 1,
  },
  howItWasMade: {
    recipe: "standard",
    releaseVersion: 5,
    fallbackRung: 0,
    revisionRounds: 1,
    estimatedCostUsd: 0.08,
    actualCostUsd: 0.09,
    ceilingUsd: 0.5,
    seconds: 58,
    steps: [],
    checkFailures: [],
    error: null,
  },
  judge: {
    hidden: false,
    overall: 6.4,
    belowBar: true,
    hardFails: [],
    evaluatorOverall: 8.1,
    evaluatorHardFails: [],
    reasons: [
      {
        source: "judge",
        code: "missed_risk_cue",
        text: "The client raised hopelessness (turn 1).",
        turns: [1],
      },
    ],
  },
  review: null,
  escalation: null,
  comments: [comment],
  verdict: null,
  scoring: { inMyScoringSample: false, scoredByMe: false },
  queue: { position: 1, total: 2, previousRunId: null, nextRunId: "run-2" },
  pendingActions: TEAM_PENDING,
  viewer: TEAM_VIEWER,
  can: {
    comment: true,
    decideFlags: true,
    publish: true,
    showTodaysDebrief: true,
    looksFine: false,
    correct: true,
    escalate: true,
    verdict: false,
    score: false,
    runAgain: false,
  },
  ...over,
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/debriefs/sessions/run-1?cat=needs"]}>
      <Routes>
        <Route path="/debriefs/sessions/:runId" element={<DebriefSessionPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.session.mockReturnValue(ok(view()));
  [h.act, h.resolve, h.correct, h.escalate, h.add, h.verdict, h.status].forEach(f =>
    f.mockReturnValue(resolves()),
  );
});

const select = (el: HTMLElement, from: number, to: number) => {
  const range = document.createRange();
  range.setStart(el.firstChild as Text, from);
  range.setEnd(el.firstChild as Text, to);
  const selection = window.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.mouseUp(el);
};
const firstTurnLine = () =>
  screen.getAllByTestId("session-turn")[0].querySelector("[data-anchor]") as HTMLElement;

describe("Session page", () => {
  it("titles the page by scenario and moves through the queue in ally-be's order", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Exam stress, first call");
    expect(screen.getByTestId("queue-position")).toHaveTextContent("1 of 2 in the queue");
    expect(screen.getByTestId("session-next")).toHaveAttribute(
      "href",
      "/debriefs/sessions/run-2?cat=needs",
    );
    expect(screen.queryByTestId("session-prev")).toBeNull();
    expect(screen.getByTestId("session-facts")).toHaveTextContent("6.4 / 10");
  });

  it("keeps the Review panel closed until asked for, with the judge's reasons inside", () => {
    renderPage();
    expect(screen.queryByTestId("review-panel")).toBeNull();
    fireEvent.click(screen.getByTestId("review-button"));
    expect(screen.getByTestId("judge-reasons")).toHaveTextContent("hopelessness (turn 1)");
  });

  describe("waiting on you", () => {
    it("shows each pending action, red first, with read-first links that highlight", () => {
      renderPage();
      const items = screen.getAllByTestId("waiting-item");
      expect(items.map(i => i.dataset.kind)).toEqual(["urgent_flag", "held"]);
      expect(items[0]).toHaveAttribute("role", "alert");
      expect(items[1]).toHaveAttribute("role", "status");
      fireEvent.click(within(items[0]).getByRole("button", { name: "the flagged card" }));
      const card = screen
        .getAllByTestId("session-card-block")
        .find(c => c.dataset.section === "work_on_this[0]") as HTMLElement;
      expect(card).toHaveAttribute("data-highlight", "true");
      fireEvent.click(within(items[0]).getByRole("button", { name: "turns 1–2 in the roleplay" }));
      expect(screen.getAllByTestId("session-turn")[0]).toHaveAttribute("data-highlight", "true");
      // Escalating lives in the panel and on "e", not in the bar.
      expect(within(items[0]).queryByRole("button", { name: /Escalate/ })).toBeNull();
    });

    it("Keep asks for the reason the learner reads, then turns the Review button green", async () => {
      renderPage();
      fireEvent.click(
        within(screen.getAllByTestId("waiting-item")[0]).getByRole("button", { name: "Keep it" }),
      );
      const dialog = screen.getByRole("dialog");
      const keep = within(dialog).getByRole("button", { name: "Keep it" });
      expect(keep).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText(/Why it stays/), {
        target: { value: "It fits." },
      });
      fireEvent.click(keep);
      await waitFor(() =>
        expect(h.resolve).toHaveBeenCalledWith({ id: "flag-1", outcome: "kept", note: "It fits." }),
      );
      await waitFor(() =>
        expect(screen.getByTestId("review-button")).toHaveTextContent("Reviewed · kept"),
      );
      expect(screen.getByTestId("review-button")).toHaveAttribute("data-reviewed", "true");
    });

    it("Publish as it is confirms first", async () => {
      renderPage();
      const held = screen.getAllByTestId("waiting-item")[1];
      fireEvent.click(within(held).getByRole("button", { name: "Publish as it is" }));
      expect(h.act).not.toHaveBeenCalled();
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Publish" }));
      await waitFor(() => expect(h.act).toHaveBeenCalledWith({ id: "run-1", action: "publish" }));
      await waitFor(() =>
        expect(screen.getByTestId("review-button")).toHaveTextContent("Reviewed · published"),
      );
    });

    it("e escalates what is waiting", async () => {
      renderPage();
      fireEvent.keyDown(window, { key: "e" });
      await waitFor(() => expect(h.escalate).toHaveBeenCalledWith({ kind: "flags", id: "flag-1" }));
    });

    it("shows no bar and no decisions to a viewer whose role can't act", () => {
      h.session.mockReturnValue(
        ok(
          view({
            viewer: NOBODY,
            pendingActions: [],
            can: { ...view().can, comment: false, decideFlags: false },
          }),
        ),
      );
      renderPage();
      expect(screen.queryByTestId("waiting-bar")).toBeNull();
      fireEvent.click(screen.getByTestId("review-button"));
      const panel = screen.getByTestId("review-panel");
      expect(within(panel).queryByRole("button", { name: "Keep it" })).toBeNull();
      expect(panel).toHaveTextContent("Nothing here waits on you.");
    });
  });

  describe("correct in place", () => {
    it("edits the flagged card where it sits, quote locked, and saves a new version", async () => {
      renderPage();
      fireEvent.click(
        within(screen.getAllByTestId("waiting-item")[0]).getByRole("button", {
          name: "Correct it",
        }),
      );
      const form = screen.getByTestId("correct-in-place");
      expect(within(form).getByTestId("correct-quote")).toHaveTextContent(
        "“Maybe we can make a timetable?” · Turn 2",
      );
      const save = within(form).getByRole("button", { name: "Save as version 2" });
      expect(save).toBeDisabled();
      fireEvent.change(within(form).getByLabelText("Try saying"), {
        target: { value: "Can you tell me more about that?" },
      });
      fireEvent.change(within(form).getByLabelText(/What changed/), {
        target: { value: "We made the question gentler." },
      });
      expect(within(form).getByTestId("correct-preview")).toHaveTextContent(
        "after a review by the Ally team: We made the question gentler.",
      );
      fireEvent.click(save);
      await waitFor(() =>
        expect(h.resolve).toHaveBeenCalledWith({
          id: "flag-1",
          outcome: "corrected",
          note: "We made the question gentler.",
          correction: { try_saying: "Can you tell me more about that?" },
        }),
      );
      await waitFor(() => expect(screen.queryByTestId("correct-in-place")).toBeNull());
      expect(screen.getByTestId("review-button")).toHaveTextContent("Reviewed · corrected");
    });

    it("corrects a held debrief's card without a flag through the run", async () => {
      h.session.mockReturnValue(
        ok(
          view({
            flags: [],
            pendingActions: [
              { ...TEAM_PENDING[1], anchors: { turns: [2], cardSection: "work_on_this[0]" } },
            ],
          }),
        ),
      );
      renderPage();
      fireEvent.click(
        within(screen.getByTestId("waiting-item")).getByRole("button", { name: "Correct it" }),
      );
      const form = screen.getByTestId("correct-in-place");
      fireEvent.change(within(form).getByLabelText("Headline"), {
        target: { value: "Pause first" },
      });
      fireEvent.change(within(form).getByLabelText(/What changed/), {
        target: { value: "Clearer." },
      });
      fireEvent.click(within(form).getByRole("button", { name: "Save as version 2" }));
      await waitFor(() =>
        expect(h.correct).toHaveBeenCalledWith({
          id: "run-1",
          section: "work_on_this[0]",
          correction: { lead: "Pause first" },
          note: "Clearer.",
        }),
      );
    });
  });

  describe("select to comment", () => {
    it("opens the pop-up under the selected words for a reviewer, and posts with a tag", async () => {
      renderPage();
      select(firstTurnLine(), 10, 31);
      const popup = screen.getByTestId("comment-popup");
      expect(popup).toHaveTextContent("“what's even the point” · Turn 1");
      fireEvent.click(within(popup).getByRole("button", { name: "Missed moment" }));
      fireEvent.change(within(popup).getByLabelText("Your comment"), {
        target: { value: "Pause here" },
      });
      fireEvent.click(within(popup).getByRole("button", { name: "Post comment" }));
      await waitFor(() =>
        expect(h.add).toHaveBeenCalledWith({
          runId: "run-1",
          comment: {
            anchorKind: "transcript",
            turnIndex: 1,
            spanStart: 10,
            spanEnd: 31,
            quotedText: "what's even the point",
            body: "Pause here",
            tag: "missed_moment",
          },
        }),
      );
    });

    it("never opens without review rights; comments stay readable and can't be resolved", () => {
      h.session.mockReturnValue(
        ok(view({ viewer: NOBODY, pendingActions: [], can: { ...view().can, comment: false } })),
      );
      renderPage();
      select(firstTurnLine(), 10, 31);
      expect(screen.queryByTestId("comment-popup")).toBeNull();
      expect(screen.getByTestId("comment-marker")).toHaveTextContent("Dr. Mehta · Missed moment");
      fireEvent.click(screen.getByTestId("review-button"));
      expect(screen.getByTestId("session-threads")).toHaveTextContent(
        "She should have paused here.",
      );
      expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull();
    });
  });

  it("the advisor gives a verdict before seeing the judge, and the button then reads Reviewed · verdict", async () => {
    h.session.mockReturnValue(
      ok(
        view({
          viewer: ADVISOR,
          judge: { hidden: true },
          pendingActions: [],
          can: { ...view().can, verdict: true, decideFlags: false },
        }),
      ),
    );
    renderPage();
    expect(screen.getByTestId("session-facts")).toHaveTextContent("After your verdict");
    fireEvent.click(screen.getByTestId("review-button"));
    fireEvent.click(screen.getByLabelText(/ignores how the learner responded/));
    fireEvent.click(screen.getByRole("button", { name: "Save verdict" }));
    await waitFor(() =>
      expect(h.verdict).toHaveBeenCalledWith({
        runId: "run-1",
        verdict: "needs_work",
        hardFails: ["missed_risk_cue"],
      }),
    );
    h.session.mockReturnValue(
      ok(
        view({
          viewer: ADVISOR,
          verdict: { verdict: "needs_work", hardFails: [], updatedAt: "x" },
        }),
      ),
    );
    renderPage();
    expect(screen.getAllByTestId("review-button")[1]).toHaveTextContent(
      "Reviewed · verdict: needs work",
    );
  });

  it("How it was made shows the learner's skill estimate, only there", () => {
    renderPage();
    expect(screen.queryByTestId("skill-row")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "How it was made" }));
    expect(screen.getByTestId("skill-row")).toHaveTextContent("Keep practising");
    expect(screen.getByTestId("skill-row")).toHaveTextContent("Too early to tell");
  });

  it("the Ask Ally tab reads the conversation, with what a replaced reply blocked", () => {
    h.session.mockReturnValue(
      ok(
        view({
          askAlly: {
            totalCostUsd: 0.003,
            distressItems: [],
            exchanges: [
              {
                question: "Why ask about safety?",
                askedAt: "2026-11-12T14:20:00Z",
                reply: "Because…",
                repliedAt: null,
                check: "passed",
                replacedReply: null,
                costUsd: 0.002,
                model: "gemini-2.5-flash",
                tools: [],
              },
              {
                question: "Just give me a script",
                askedAt: "2026-11-12T14:22:00Z",
                reply: "There isn't one line.",
                repliedAt: null,
                check: "replaced",
                replacedReply: { reply: "Here is a script…", fails: ["quote_mismatch"] },
                costUsd: 0.001,
                model: null,
                tools: [],
              },
            ],
          },
        }),
      ),
    );
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Ask Ally · 2" }));
    expect(screen.getByTestId("ask-summary")).toHaveTextContent("2 questions");
    expect(screen.getByTestId("ask-summary")).toHaveTextContent("1 reply replaced by the fallback");
    expect(screen.getByTestId("ask-summary")).toHaveTextContent("No distress found");
    const [, replaced] = screen.getAllByTestId("ask-exchange");
    expect(replaced).toHaveTextContent("Replaced by the fallback");
    expect(replaced).toHaveTextContent("Here is a script…");
  });
});
