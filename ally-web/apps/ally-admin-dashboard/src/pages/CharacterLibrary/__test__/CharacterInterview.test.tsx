import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CharacterInterview } from "../CharacterInterview";

vi.mock("@api", () => ({
  useAbandonCharacterInterviewSessionMutation: vi.fn(),
  useCreateCharacterInterviewSessionMutation: vi.fn(),
  useLazyGetCharacterInterviewSessionQuery: vi.fn(),
  baseAPI: {
    reducerPath: "api",
    reducer: () => ({}),
    middleware: () => (next: any) => (action: any) => next(action),
  },
  evaluatorAPI: {
    reducerPath: "evaluatorApi",
    reducer: () => ({}),
    middleware: () => (next: any) => (action: any) => next(action),
  },
}));

import * as api from "@api";
import { useCharacterInterviewStream } from "@hooks/useCharacterInterviewStream";
import { toast } from "sonner";

vi.mock("@assets", () => ({
  ArrowDown: () => <svg data-testid="arrow-down-icon" />,
}));

vi.mock("@components", () => ({
  // Renders its primary action while open, so a test can confirm Leave.
  ActionConfirmationPopup: (props: {
    isOpen: boolean;
    primaryButton: { label: string; onClick: () => void };
  }) =>
    props.isOpen ? (
      <button onClick={props.primaryButton.onClick}>{props.primaryButton.label}</button>
    ) : null,
  CharacterSidePanel: () => null,
}));
vi.mock("@components/character-insights", () => ({
  CharacterInsightsCard: ({ compact }: any) => (
    <span data-testid="character-insights-card">{compact ? "compact" : "card"}</span>
  ),
}));
vi.mock("@components/character-interview", () => ({
  ChatComposer: () => <div data-testid="chat-composer" />,
  ChatMessage: () => <div data-testid="chat-message" />,
  VoiceShortlistStrip: () => <div data-testid="voice-shortlist-strip" />,
}));

vi.mock("@hooks", () => ({
  useUser: vi.fn(() => ({
    featureFlags: {},
  })),
}));
// The page imports the stream hook from its leaf module, so the "@hooks"
// barrel mock above never reached it and the real hook ran.
vi.mock("@hooks/useCharacterInterviewStream", () => ({
  useCharacterInterviewStream: vi.fn(() => ({
    messages: [],
    isStreaming: false,
    sendMessage: vi.fn(),
    stop: vi.fn(),
    hydrateMessages: vi.fn(),
    resetMessages: vi.fn(),
  })),
}));

vi.mock("@constants", () => ({
  en: {
    characterInterview: {
      title: "Interview a character",
      startFailed: "Failed to start session",
      draftReadyToast: "Draft ready",
      reviewCharacter: "Review Character",
      exitConfirmTitle: "Exit?",
      exitConfirmDescription: "Progress will be lost.",
      exitConfirmLeave: "Leave",
      exitConfirmStay: "Stay",
      startOver: "Start over",
    },
    simulation: {
      characters: "Characters",
    },
  },
  LOCAL_STORAGE_KEYS: {
    CHARACTER_INTERVIEW_SESSION_ID: "char_interview_session_id",
  },
  ROUTES: {
    CHARACTER_LIBRARY: "/character-library",
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async importOriginal => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const renderCharacterInterview = () =>
  render(
    <MemoryRouter>
      <CharacterInterview />
    </MemoryRouter>,
  );

describe("CharacterInterview", () => {
  const mockCreateSession = vi.fn();
  const mockGetSession = vi.fn();
  const mockAbandonSession = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockCreateSession.mockReturnValue({ unwrap: () => Promise.resolve({ id: "new-session" }) });
    mockGetSession.mockReturnValue({
      unwrap: () => Promise.resolve({ id: "session-123", status: "ACTIVE", messages: [] }),
    });
    mockAbandonSession.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    (api.useAbandonCharacterInterviewSessionMutation as ReturnType<typeof vi.fn>).mockReturnValue([
      mockAbandonSession,
    ]);

    (api.useCreateCharacterInterviewSessionMutation as ReturnType<typeof vi.fn>).mockReturnValue([
      mockCreateSession,
    ]);
    (api.useLazyGetCharacterInterviewSessionQuery as ReturnType<typeof vi.fn>).mockReturnValue([
      mockGetSession,
    ]);
  });

  it("should have the arrow icon inside the clickable back button", async () => {
    renderCharacterInterview();
    await screen.findByText("Characters");
    const charactersLink = screen.getByText("Characters");
    // The ArrowDown icon should be inside the clickable element for it to be a single control
    expect(charactersLink.querySelector('[data-testid="arrow-down-icon"]')).toBeInTheDocument();
  });

  it("links to what the interview draws on, compactly, in the header", async () => {
    renderCharacterInterview();
    await screen.findByText("Characters");
    expect(screen.getByTestId("character-insights-card")).toHaveTextContent("compact");
  });

  it("toasts the server's own reason when the interview can't start", async () => {
    // Production, 2026-11-03: the org was at its in-progress cap and the
    // server said so, with what to do about it — the toast used to replace
    // that with the generic line.
    const reason =
      "Your organisation already has 10 interviews in progress. Finish or discard one before starting another.";
    mockCreateSession.mockReturnValue({
      unwrap: () => Promise.reject({ status: 403, data: { statusCode: 403, message: reason } }),
    });

    renderCharacterInterview();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(reason));
  });

  it("falls back to the generic line when the failure carries no message", async () => {
    mockCreateSession.mockReturnValue({
      unwrap: () => Promise.reject({ status: "FETCH_ERROR", error: "offline" }),
    });

    renderCharacterInterview();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to start session"));
  });

  it("tells the server the interview is abandoned on Leave", async () => {
    localStorage.setItem("char_interview_session_id", "session-123");
    vi.mocked(useCharacterInterviewStream).mockReturnValue({
      messages: [{ id: "a1", role: "assistant", content: "Who is this character?" }],
      isStreaming: false,
      sendMessage: vi.fn(),
      stop: vi.fn(),
      hydrateMessages: vi.fn(),
      resetMessages: vi.fn(),
    } as any);

    renderCharacterInterview();
    await waitFor(() => expect(mockGetSession).toHaveBeenCalledWith("session-123"));

    fireEvent.click(await screen.findByText("Characters"));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));

    // Left ACTIVE, the session would keep a slot under the org's in-progress
    // cap until the idle window passed.
    expect(mockAbandonSession).toHaveBeenCalledWith("session-123");
    expect(mockNavigate).toHaveBeenCalled();
  });
});
