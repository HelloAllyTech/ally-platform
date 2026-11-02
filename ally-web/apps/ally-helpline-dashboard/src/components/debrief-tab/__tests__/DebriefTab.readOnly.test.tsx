import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { DebriefTab } from "../DebriefTab";

/**
 * `readOnly` is the revisit mode: the learner's own session logs, and their org
 * admin's view of the same session under org logs. It is a privacy boundary as
 * much as a layout choice, so these tests assert what is NOT rendered and NOT
 * fetched, not just what is.
 */

const mockChatHistoryQuery = vi.hoisted(() => vi.fn());
const mockSendMessage = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("react-redux", () => ({
  useDispatch: () => vi.fn(),
  useSelector: () => undefined,
}));

const mockSupervisorQuery = vi.hoisted(() => vi.fn(() => ({ data: undefined })));
vi.mock("@api", () => ({
  useGetSupervisorDebriefQuery: (...args: unknown[]) => mockSupervisorQuery(...args),
  useLazyGetDebriefCardAudioQuery: () => [vi.fn()],
  useMarkDebriefReadMutation: () => [vi.fn()],
  useGetChatHistoryQuery: (...args: unknown[]) => mockChatHistoryQuery(...args),
  // The learner's org isn't on the new Debrief agent here, so today's view stays.
  useGetLearnerDebriefQuery: () => ({ data: { state: "not_available" } }),
  LEARNER_DEBRIEF_POLL_MS: 3000,
  LEARNER_DEBRIEF_SLOW_POLL_MS: 30000,
  LEARNER_DEBRIEF_FAST_FOR_MS: 240000,
}));

vi.mock("@assets", () => ({
  AskAiIcon: () => <svg data-testid="ally-avatar" />,
  Refresh: () => <svg />,
}));

vi.mock("@hooks", () => ({
  useSendMessage: () => mockSendMessage(),
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

const summaryWithNote = () =>
  ({
    details: { summary: { feedback: { supervisorNote: NOTE } } },
  }) as any;

describe("DebriefTab — readOnly (revisit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatHistoryQuery.mockReturnValue({ data: undefined, isLoading: false });
    mockSendMessage.mockReturnValue({
      messages: [
        { role: "user", content: "Why was that a miss?" },
        { role: "assistant", content: "At [4:12] you moved on." },
      ],
      streamingMessage: undefined,
      isStreaming: false,
      error: undefined,
      sendMessage: vi.fn(),
      retryLastMessage: vi.fn(),
    });
  });

  it("shows the note", () => {
    render(
      <DebriefTab
        sessionId="s-1"
        summaryData={summaryWithNote()}
        retryMaxReached={false}
        readOnly
      />,
    );

    expect(screen.getByTestId("supervisor-note")).toHaveTextContent(NOTE);
  });

  it("hides the past conversation, not merely the composer", () => {
    render(
      <DebriefTab
        sessionId="s-1"
        summaryData={summaryWithNote()}
        retryMaxReached={false}
        readOnly
      />,
    );

    expect(screen.queryByText("Why was that a miss?")).not.toBeInTheDocument();
    expect(screen.queryByText(/you moved on/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("reply-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("debrief-feedback")).not.toBeInTheDocument();
  });

  it("does not even fetch the conversation", () => {
    // The privacy point: an org admin opening a learner's session must not
    // pull that learner's coaching thread into the store, whether or not it
    // would have been painted.
    render(
      <DebriefTab
        sessionId="s-1"
        summaryData={summaryWithNote()}
        retryMaxReached={false}
        readOnly
      />,
    );

    expect(mockChatHistoryQuery).toHaveBeenCalledWith({ sessionId: "s-1" }, { skip: true });
  });

  it("does not invite a reply", () => {
    render(
      <DebriefTab
        sessionId="s-1"
        summaryData={summaryWithNote()}
        retryMaxReached={false}
        readOnly
      />,
    );

    expect(screen.queryByText("postSim.debrief.replyPrompt")).not.toBeInTheDocument();
  });
});

describe("DebriefTab — full mode (just finished)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatHistoryQuery.mockReturnValue({ data: undefined, isLoading: false });
    mockSendMessage.mockReturnValue({
      messages: [{ role: "user", content: "Why was that a miss?" }],
      streamingMessage: undefined,
      isStreaming: false,
      error: undefined,
      sendMessage: vi.fn(),
      retryLastMessage: vi.fn(),
    });
  });

  it("shows the thread and the composer, and fetches the history", () => {
    render(<DebriefTab sessionId="s-1" summaryData={summaryWithNote()} retryMaxReached={false} />);

    expect(screen.getByTestId("supervisor-note")).toBeInTheDocument();
    expect(screen.getByText("Why was that a miss?")).toBeInTheDocument();
    expect(screen.getByTestId("reply-input")).toBeInTheDocument();
    expect(screen.getByTestId("debrief-feedback")).toBeInTheDocument();
    expect(mockChatHistoryQuery).toHaveBeenCalledWith({ sessionId: "s-1" }, { skip: false });
  });
});

describe("DebriefTab — a supervisor on Roleplay Logs (FR-26)", () => {
  const CARDS = {
    opening: "You stayed calm.",
    what_worked: [
      {
        skill: "Listening",
        turn_index: 2,
        quote: "Go on.",
        lead: "You let her lead.",
        body: "It helped.",
      },
    ],
    work_on_this: [],
    practise_next: null,
    skill_words: [],
    reflective_question: "What was hard?",
  };

  it("reads the learner's debrief, flag, answer and thread, with no buttons", () => {
    mockSupervisorQuery.mockReturnValue({
      data: {
        state: "ready",
        readOnly: true,
        cards: CARDS,
        language: "en",
        corrections: [],
        flags: [
          {
            section: "what_worked[0]",
            reason: "didnt_say",
            note: "I never said that",
            status: "open",
            resolutionNote: null,
          },
        ],
        helpful: false,
        thread: [
          { role: "learner", content: "Why that point?", at: "2026-11-02T10:00:00Z" },
          { role: "ally", content: "Because you waited.", at: "2026-11-02T10:00:05Z" },
        ],
      },
    } as never);
    render(
      <DebriefTab
        sessionId="s-1"
        summaryData={undefined as never}
        retryMaxReached={false}
        readOnly
      />,
    );

    expect(screen.getByTestId("debrief-cards")).toBeInTheDocument();
    expect(screen.getByTestId("debrief-supervisor-flag")).toHaveTextContent(
      "postSim.debriefCards.supervisor.flagged",
    );
    expect(screen.getByTestId("debrief-supervisor-helpful")).toHaveTextContent(
      "postSim.debriefCards.supervisor.helpfulNo",
    );
    expect(screen.getByTestId("supervisor-thread")).toHaveTextContent("Why that point?");
    expect(screen.queryByText("postSim.debriefCards.flag.open")).not.toBeInTheDocument();
    expect(screen.queryByText("postSim.debriefCards.listen.all")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reply-input")).not.toBeInTheDocument();
  });
});
