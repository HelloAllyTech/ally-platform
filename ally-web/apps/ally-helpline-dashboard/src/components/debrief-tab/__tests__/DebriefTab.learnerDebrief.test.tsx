import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { DebriefTab } from "../DebriefTab";

/**
 * The Debrief agent's debrief swaps in for today's supervisor note only when
 * the learner's organisation is switched on. Every other answer — the org is
 * off (`not_available`), or the request failed — must leave today's view as it
 * was, so these tests pin both sides of that swap.
 */

const mockLearnerDebriefQuery = vi.hoisted(() => vi.fn());
const mockMutations = vi.hoisted(() => ({ helpful: vi.fn(), flag: vi.fn(), undo: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-redux", () => ({
  useDispatch: () => vi.fn(),
  useSelector: () => undefined,
}));

vi.mock("@api", () => ({
  useGetChatHistoryQuery: () => ({ data: undefined, isLoading: false }),
  useGetLearnerDebriefQuery: (...args: unknown[]) => mockLearnerDebriefQuery(...args),
  useSetDebriefHelpfulMutation: () => [mockMutations.helpful, { isLoading: false }],
  useFlagDebriefCardMutation: () => [mockMutations.flag, { isLoading: false }],
  useUndoDebriefFlagMutation: () => [mockMutations.undo, { isLoading: false }],
  LEARNER_DEBRIEF_POLL_MS: 5000,
}));

vi.mock("@assets", () => ({
  AskAiIcon: () => <svg />,
  Refresh: () => <svg />,
}));

vi.mock("@hooks", () => ({
  useSendMessage: () => ({
    messages: [],
    streamingMessage: undefined,
    isStreaming: false,
    error: undefined,
    sendMessage: vi.fn(),
    retryLastMessage: vi.fn(),
  }),
}));

vi.mock("@reducer", () => ({ initSession: vi.fn() }));
vi.mock("@store", () => ({}));

vi.mock("../SupervisorNote", () => ({
  SupervisorNote: ({ note }: { note: string }) => <div data-testid="supervisor-note">{note}</div>,
}));
vi.mock("../DebriefReplyInput", () => ({
  DebriefReplyInput: () => <div data-testid="reply-input" />,
}));
vi.mock("../DebriefFeedback", () => ({
  DebriefFeedback: () => <div data-testid="debrief-feedback" />,
}));

const NOTE = "You opened well and stayed with her silence.";
const summaryWithNote = { details: { summary: { feedback: { supervisorNote: NOTE } } } } as any;

const renderTab = () =>
  render(<DebriefTab sessionId="s-1" summaryData={summaryWithNote} retryMaxReached={false} />);

const CARDS = {
  opening: "You stayed calm when Meena went quiet.",
  important_moment: {
    turn_index: 7,
    quote: "I don't see the point any more.",
    handled_well: true,
    lead: "You noticed this and asked directly — that was the right call.",
    body: "Asking about safety plainly helps the person feel heard.",
  },
  what_worked: [
    {
      skill: "Reflective listening",
      turn_index: 3,
      quote: "It sounds like you feel alone.",
      lead: "You named her feeling.",
      body: "Naming a feeling shows you heard what's underneath.",
    },
  ],
  work_on_this: [
    {
      skill: "Open questions",
      turn_index: 5,
      quote: "Did you talk to your mother?",
      lead: "This question closed the conversation.",
      why: "A yes/no question gives her an easy way out.",
      try_saying: "What happened when you talked to your mother?",
    },
  ],
  practise_next: { skill: "Open questions", reason: "It came up twice today." },
  skill_words: [
    { skill: "Reflective listening", word: "strength" },
    { skill: "Open questions", word: "keep_practising" },
    { skill: "Safety planning", word: "didnt_come_up" },
  ],
  reflective_question: "What made it hard to ask an open question there?",
  progress_note: "You asked more open questions than last time.",
};

describe("DebriefTab — learner debrief (Debrief agent)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps today's debrief when the organisation isn't switched on", () => {
    mockLearnerDebriefQuery.mockReturnValue({ data: { state: "not_available" } });
    renderTab();

    expect(screen.getByTestId("supervisor-note")).toHaveTextContent(NOTE);
    expect(screen.getByText("postSim.debrief.header")).toBeInTheDocument();
    expect(screen.queryByTestId("debrief-cards")).not.toBeInTheDocument();
    // No polling for an org that isn't on the new debrief.
    expect(mockLearnerDebriefQuery).toHaveBeenLastCalledWith(
      "s-1",
      expect.objectContaining({ pollingInterval: 0 }),
    );
  });

  it("falls back to today's debrief silently when the request fails", () => {
    mockLearnerDebriefQuery.mockReturnValue({
      data: undefined,
      isError: true,
      error: { status: 500 },
    });
    renderTab();

    expect(screen.getByTestId("supervisor-note")).toHaveTextContent(NOTE);
    expect(screen.queryByTestId("debrief-cards")).not.toBeInTheDocument();
    expect(screen.queryByText("common.somethingWentWrong")).not.toBeInTheDocument();
  });

  it("keeps today's debrief while the first answer is loading", () => {
    mockLearnerDebriefQuery.mockReturnValue({ data: undefined, isLoading: true });
    renderTab();

    expect(screen.getByTestId("supervisor-note")).toBeInTheDocument();
    expect(screen.queryByTestId("debrief-cards")).not.toBeInTheDocument();
  });

  it("renders the ready debrief in order, with a distinct 'Try saying' line", () => {
    mockLearnerDebriefQuery.mockReturnValue({
      data: { state: "ready", cards: CARDS, language: "hi-IN" },
    });
    renderTab();

    expect(screen.queryByTestId("supervisor-note")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reply-input")).not.toBeInTheDocument();

    const container = screen.getByTestId("debrief-cards");
    expect(container).toHaveAttribute("lang", "hi");
    expect(screen.getByText("postSim.debriefCards.header")).toBeInTheDocument();
    expect(screen.getByText("postSim.debriefCards.aiLabel")).toBeInTheDocument();

    const order = [
      "debrief-card-important-moment",
      "debrief-card-opening",
      "debrief-card-what-worked",
      "debrief-card-work-on-this",
      "debrief-card-practise-next",
      "debrief-card-skill-words",
      "debrief-card-progress-note",
      "debrief-card-reflective-question",
    ].map(id => screen.getByTestId(id));
    for (let i = 1; i < order.length; i += 1) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }

    const moment = screen.getByTestId("debrief-card-important-moment");
    expect(within(moment).getByText(CARDS.important_moment.lead)).toBeInTheDocument();
    expect(
      within(moment).getByText("postSim.debriefCards.importantMoment.support"),
    ).toBeInTheDocument();

    const worked = screen.getByTestId("debrief-card-what-worked");
    expect(within(worked).getByText(`“${CARDS.what_worked[0].quote}”`)).toBeInTheDocument();

    const trySaying = screen.getByTestId("debrief-try-saying");
    expect(trySaying).toHaveTextContent("postSim.debriefCards.trySaying");
    expect(trySaying).toHaveTextContent(CARDS.work_on_this[0].try_saying);

    // Skill words carry text, not colour alone.
    const words = screen.getByTestId("debrief-card-skill-words");
    expect(within(words).getByText("postSim.debriefCards.skillWords.strength")).toBeInTheDocument();
    expect(
      within(words).getByText("postSim.debriefCards.skillWords.keep_practising"),
    ).toBeInTheDocument();
    expect(
      within(words).getByText("postSim.debriefCards.skillWords.didnt_come_up"),
    ).toBeInTheDocument();

    // Every card is a list item with a heading.
    for (const id of ["debrief-card-what-worked", "debrief-card-reflective-question"]) {
      const card = screen.getByTestId(id);
      expect(card.tagName).toBe("LI");
      expect(within(card).getAllByRole("heading").length).toBeGreaterThan(0);
    }

    // No numeric score anywhere.
    expect(container.textContent).not.toMatch(/\d+\s*(%|\/\s*\d+)/);
  });

  it("shows a calm progress panel with the latest step while working, and polls", () => {
    mockLearnerDebriefQuery.mockReturnValue({
      data: { state: "working", steps: ["Reading your session…", "Finding what worked…"] },
    });
    renderTab();

    const panel = screen.getByTestId("debrief-working");
    expect(panel).toHaveAttribute("aria-live", "polite");
    expect(panel).toHaveTextContent("Finding what worked…");
    expect(panel).not.toHaveTextContent("Reading your session…");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("supervisor-note")).not.toBeInTheDocument();
    expect(mockLearnerDebriefQuery).toHaveBeenLastCalledWith(
      "s-1",
      expect.objectContaining({ pollingInterval: 5000 }),
    );
  });

  it("falls back to the default step label when no steps have arrived", () => {
    mockLearnerDebriefQuery.mockReturnValue({ data: { state: "working", steps: [] } });
    renderTab();

    expect(screen.getByTestId("debrief-working")).toHaveTextContent(
      "postSim.debriefCards.working.defaultStep",
    );
  });

  it.each([
    ["on_its_way", "postSim.debriefCards.onItsWay"],
    ["too_short", "postSim.debriefCards.tooShort"],
  ])("shows the %s message instead of today's debrief", (state, key) => {
    mockLearnerDebriefQuery.mockReturnValue({ data: { state } });
    renderTab();

    expect(screen.getByText(key)).toBeInTheDocument();
    expect(screen.queryByTestId("supervisor-note")).not.toBeInTheDocument();
  });

  describe("feedback and review outcomes", () => {
    const ready = (extra: Record<string, unknown> = {}) =>
      mockLearnerDebriefQuery.mockReturnValue({
        data: { state: "ready", runId: "r1", cards: CARDS, language: "en", ...extra },
        isLoading: false,
        isError: false,
      });

    beforeEach(() => {
      Object.values(mockMutations).forEach(m =>
        m.mockReturnValue({ unwrap: () => Promise.resolve({}) }),
      );
    });

    it("lists every other risk moment under the important moment", () => {
      ready({
        cards: {
          ...CARDS,
          important_moment: {
            ...CARDS.important_moment,
            others: [
              { turn_index: 9, quote: "Nobody would notice.", note: "You moved on quickly." },
            ],
          },
        },
      });
      renderTab();
      expect(screen.getByTestId("debrief-other-moments")).toHaveTextContent("Nobody would notice.");
    });

    it("sends a flag on one card with a reason, and offers Undo while it can", async () => {
      ready();
      renderTab();
      const growth = screen.getByTestId("debrief-card-work-on-this");
      fireEvent.click(
        within(growth).getByRole("button", { name: "postSim.debriefCards.flag.openLabel" }),
      );
      const send = screen.getByRole("button", { name: "postSim.debriefCards.flag.send" });
      expect(send).toBeDisabled();
      fireEvent.click(screen.getByLabelText("postSim.debriefCards.flag.reasons.advice_doesnt_fit"));
      fireEvent.click(send);
      await waitFor(() =>
        expect(mockMutations.flag).toHaveBeenCalledWith({
          sessionId: "s-1",
          section: "work_on_this[0]",
          reason: "advice_doesnt_fit",
          note: undefined,
        }),
      );
    });

    it("an open flag shows Undo inside the window, then the waiting line", () => {
      const until = new Date(Date.now() + 60_000).toISOString();
      ready({
        feedback: {
          helpful: null,
          flags: [{ id: "f1", section: "what_worked[0]", status: "open", canUndoUntil: until }],
        },
      });
      renderTab();
      const worked = screen.getByTestId("debrief-card-what-worked");
      fireEvent.click(
        within(worked).getByRole("button", { name: "postSim.debriefCards.flag.undo" }),
      );
      expect(mockMutations.undo).toHaveBeenCalledWith({ sessionId: "s-1", flagId: "f1" });
    });

    it("hides a removed card by its stored index and says a point was removed", () => {
      ready({
        corrections: [{ section: "work_on_this[0]", outcome: "removed", note: null, at: "" }],
      });
      renderTab();
      expect(screen.queryByTestId("debrief-card-work-on-this")).toBeNull();
      expect(screen.getByTestId("debrief-removed-note")).toBeInTheDocument();
    });

    it("shows the reviewer's reason on a card the Ally team kept", () => {
      ready({
        corrections: [
          { section: "what_worked[0]", outcome: "kept", note: "It is in turn 3.", at: "" },
        ],
        feedback: {
          helpful: null,
          flags: [{ id: "f1", section: "what_worked[0]", status: "kept", canUndoUntil: null }],
        },
      });
      renderTab();
      expect(screen.getByTestId("debrief-correction")).toHaveTextContent(
        "postSim.debriefCards.corrections.kept",
      );
    });

    it("asks whether it was helpful and records the answer", () => {
      ready({ feedback: { helpful: true, flags: [] } });
      renderTab();
      const helpful = screen.getByTestId("debrief-helpful");
      expect(
        within(helpful).getByRole("button", { name: "postSim.debriefCards.helpful.yes" }),
      ).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(
        within(helpful).getByRole("button", { name: "postSim.debriefCards.helpful.no" }),
      );
      expect(mockMutations.helpful).toHaveBeenCalledWith({ sessionId: "s-1", helpful: false });
    });
  });
});
