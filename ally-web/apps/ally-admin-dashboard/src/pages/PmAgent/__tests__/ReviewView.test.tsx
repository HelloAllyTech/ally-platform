import React from "react";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PmCard } from "@types";

import { questionCard, recCard, stateOf } from "./fixtures";

const h = vi.hoisted(() => {
  const ok = (value: unknown = {}) => vi.fn(() => ({ unwrap: () => Promise.resolve(value) }));
  const toastFn = Object.assign(
    vi.fn(() => "toast-id"),
    {
      success: vi.fn(),
      error: vi.fn(),
      message: vi.fn(),
      custom: vi.fn(),
      dismiss: vi.fn(),
    },
  );
  return {
    toastFn,
    cards: { current: [] as unknown[] },
    cardsError: { current: false },
    accept: ok({ undoUntil: new Date(Date.now() + 10_000).toISOString() }),
    undo: ok(),
    reject: ok(),
    reason: ok(),
    feedback: ok(),
    answer: ok(),
    skip: ok(),
    retry: ok(),
    dismiss: ok(),
    plan: ok("# plan"),
    ok,
  };
});

vi.mock("sonner", () => ({ toast: h.toastFn }));
vi.mock("@api", () => ({
  useGetPmAgentCardsQuery: () => ({
    data: { cards: h.cards.current },
    isLoading: false,
    isError: h.cardsError.current,
    refetch: vi.fn(),
  }),
  useGetPmAgentCardQuery: () => ({ data: { evidence: [{ id: "e1", label: "Retention chart" }] } }),
  useAcceptPmAgentCardMutation: () => [h.accept, {}],
  useUndoPmAgentCardMutation: () => [h.undo, {}],
  useRejectPmAgentCardMutation: () => [h.reject, {}],
  useReasonPmAgentCardMutation: () => [h.reason, {}],
  useFeedbackPmAgentCardMutation: () => [h.feedback, {}],
  useAnswerPmAgentCardMutation: () => [h.answer, {}],
  useSkipPmAgentCardMutation: () => [h.skip, {}],
  useRetryPmAgentCardMutation: () => [h.retry, {}],
  useDismissPmAgentCardMutation: () => [h.dismiss, {}],
  useLazyGetPmAgentPlanMdQuery: () => [h.plan, {}],
  useRunPmAgentNowMutation: () => [h.ok({ started: true }), { isLoading: false }],
  useUpdatePmAgentSettingsMutation: () => [h.ok({}), { isLoading: false }],
}));

import { ReviewView } from "../ReviewView";

const setCards = (cards: PmCard[]) => {
  h.cards.current = cards;
};
const renderView = (state = stateOf()) =>
  render(<ReviewView state={state} onOpenSettings={vi.fn()} />);
const press = (key: string) => fireEvent.keyDown(window, { key });

describe("ReviewView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.cardsError.current = false;
    setCards([recCard("a"), recCard("b"), questionCard("q")]);
  });

  it("renders a recommendation card's 10-second layer with chips as words", () => {
    renderView();
    expect(screen.getAllByText("Card a").length).toBeGreaterThan(0);
    expect(screen.getByText(/41% of learners/)).toBeInTheDocument();
    expect(screen.getByText("Add a streak chip to Start")).toBeInTheDocument();
    expect(screen.getByText("Low risk")).toBeInTheDocument();
    expect(screen.getByText("Small")).toBeInTheDocument();
    expect(screen.getByText(/next-day return rate \(should rise\)/)).toBeInTheDocument();
    expect(screen.getByText("Ships to production automatically")).toBeInTheDocument();
    expect(screen.getByText("2 of 3".replace("2", "1"))).toBeInTheDocument();
  });

  it("opens the full plan and the evidence on demand", () => {
    renderView();
    expect(screen.queryByText("Add chip")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Full plan/ }));
    expect(screen.getByText("Add chip")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Evidence \(2\)/ }));
    expect(screen.getByText("Retention chart")).toBeInTheDocument();
  });

  it("renders a question card with a suggested option and answers with one click", async () => {
    setCards([questionCard("q")]);
    renderView();
    expect(screen.getAllByText("Suggested").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Enterprise tenants/ }));
    await waitFor(() => expect(h.answer).toHaveBeenCalledWith({ id: "q", optionIndex: 0 }));
  });

  it("validates the 'Something else' answer", async () => {
    setCards([questionCard("q")]);
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Something else" }));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(await screen.findByText("Write an answer before sending.")).toBeInTheDocument();
    expect(h.answer).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "Rural tenants" } });
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() =>
      expect(h.answer).toHaveBeenCalledWith({ id: "q", customText: "Rural tenants" }),
    );
  });

  it("accept hides the card at once, shows an undo toast, and undo restores it", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /Accept and build/ }));
    await waitFor(() => expect(h.accept).toHaveBeenCalledWith({ id: "a", path: "builder" }));
    // Focus moved to the next card.
    expect(screen.getAllByText("Card b").length).toBeGreaterThan(0);
    expect(screen.queryByRole("article", { name: "Card a" })).not.toBeInTheDocument();
    await waitFor(() => expect(h.toastFn).toHaveBeenCalled());
    const [message, opts] = h.toastFn.mock.calls[0] as unknown as [
      string,
      { action: { label: string; onClick: () => void }; duration: number },
    ];
    expect(message).toBe("Accepted: Card a");
    expect(opts.action.label).toBe("Undo");
    expect(opts.duration).toBeGreaterThan(1000);
    await act(async () => {
      opts.action.onClick();
    });
    expect(h.undo).toHaveBeenCalledWith("a");
    await waitFor(() =>
      expect(screen.getByRole("article", { name: "Card a" })).toBeInTheDocument(),
    );
  });

  it("restores the card with an error toast when the accept fails", async () => {
    h.accept.mockImplementationOnce(() => ({ unwrap: () => Promise.reject({ status: 500 }) }));
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /Accept and build/ }));
    await waitFor(() => expect(h.toastFn.error).toHaveBeenCalled());
    expect(screen.getByRole("article", { name: "Card a" })).toBeInTheDocument();
  });

  it("asks for one inline confirm on a medium-risk card before building", async () => {
    setCards([recCard("m", {}, { risk: "medium", riskWhy: "Touches the XP ledger." })]);
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /Accept and build/ }));
    expect(h.accept).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Touches the XP ledger.");
    fireEvent.click(screen.getByRole("button", { name: "Build and release" }));
    await waitFor(() => expect(h.accept).toHaveBeenCalledWith({ id: "m", path: "builder" }));
  });

  it("reject is one click and offers reason chips afterwards", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /^Reject/ }));
    await waitFor(() => expect(h.reject).toHaveBeenCalledWith({ id: "a" }));
    await waitFor(() => expect(h.toastFn.custom).toHaveBeenCalled());
    const render1 = (
      h.toastFn.custom.mock.calls[0] as unknown as [(id: string) => React.ReactElement]
    )[0];
    render(render1("t1"));
    fireEvent.click(screen.getByRole("button", { name: "Too risky" }));
    await waitFor(() =>
      expect(h.reason).toHaveBeenCalledWith({ id: "a", reasonChip: "too_risky" }),
    );
  });

  it("feedback needs a note, then sends with chips and the revise-now flag", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /Give feedback/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Write what should change before sending.")).toBeInTheDocument();
    expect(h.feedback).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Smaller scope" }));
    fireEvent.change(screen.getByLabelText("What should change?"), {
      target: { value: "  Do less " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send and revise now" }));
    await waitFor(() =>
      expect(h.feedback).toHaveBeenCalledWith({
        id: "a",
        text: "Do less",
        chips: ["Smaller scope"],
        reviseNow: true,
      }),
    );
  });

  it("keyboard: j/k move, a accepts, r rejects, 1 answers a question, z toggles focus", async () => {
    renderView();
    press("j");
    expect(screen.getByRole("article", { name: "Card b" })).toBeInTheDocument();
    press("k");
    expect(screen.getByRole("article", { name: "Card a" })).toBeInTheDocument();
    press("z");
    expect(screen.getByRole("button", { name: /Exit focus/ })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Cards to review" })).not.toBeInTheDocument();
    press("Escape");
    expect(screen.getByRole("navigation", { name: "Cards to review" })).toBeInTheDocument();
    press("r");
    await waitFor(() => expect(h.reject).toHaveBeenCalledWith({ id: "a" }));
    press("a");
    await waitFor(() => expect(h.accept).toHaveBeenCalledWith({ id: "b", path: "builder" }));
    press("1");
    await waitFor(() => expect(h.answer).toHaveBeenCalledWith({ id: "q", optionIndex: 0 }));
  });

  it("keyboard shortcuts are off while typing in a field", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /Give feedback/ }));
    const box = screen.getByLabelText("What should change?");
    fireEvent.keyDown(box, { key: "r" });
    fireEvent.keyDown(box, { key: "a" });
    expect(h.reject).not.toHaveBeenCalled();
    expect(h.accept).not.toHaveBeenCalled();
  });

  it("opens the shortcut list with ?", () => {
    renderView();
    press("?");
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });

  it("shows needs-you items first with Retry and Dismiss", async () => {
    setCards([
      recCard("a"),
      recCard("f", {
        status: "failed",
        needsYou: { reason: "The build failed.", actions: ["retry", "dismiss"] },
      }),
    ]);
    renderView();
    expect(screen.getByText("The build failed.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(h.retry).toHaveBeenCalledWith("f"));
  });

  it("explains a full queue", () => {
    renderView(stateOf({ agentState: "queue_full", queue: { open: 5, cap: 5, needsYou: 0 } }));
    expect(
      screen.getByText("5 cards waiting. The agent pauses until you decide on some."),
    ).toBeInTheDocument();
  });

  it("says all caught up with the next run and a Run now control", () => {
    setCards([]);
    renderView(
      stateOf({
        queue: { open: 0, cap: 5, needsYou: 0 },
        nextRunAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    );
    expect(screen.getByText(/All caught up\. Next run/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run now" })).toBeInTheDocument();
  });

  it("says nothing met the bar when the last run created no cards", () => {
    setCards([]);
    renderView(
      stateOf({
        queue: { open: 0, cap: 5, needsYou: 0 },
        lastRun: { status: "succeeded", cardsCreated: 0 },
      }),
    );
    expect(screen.getByText(/nothing met the bar/)).toBeInTheDocument();
  });

  it("shows the circuit-breaker banner with Resume builds", () => {
    renderView(stateOf({ autoBuildPaused: true }));
    expect(screen.getByRole("button", { name: "Resume builds" })).toBeInTheDocument();
  });

  it("shows first-run setup when the agent has never been on", () => {
    setCards([]);
    renderView(stateOf({ lastRun: null, settings: { ...stateOf().settings, enabled: false } }));
    expect(screen.getByRole("button", { name: "Turn on the agent" })).toBeInTheDocument();
  });

  it("keeps cached cards readable but disables actions when a refresh fails", () => {
    h.cardsError.current = true;
    renderView();
    expect(screen.getByRole("article", { name: "Card a" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Accept and build/ })).toBeDisabled();
    expect(screen.getByText(/last cards that loaded/)).toBeInTheDocument();
  });
});
