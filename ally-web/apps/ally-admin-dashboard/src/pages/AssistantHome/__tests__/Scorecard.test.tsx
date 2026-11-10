import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  data: { current: null as unknown },
  answer: vi.fn(),
  correct: vi.fn(),
  fine: vi.fn(),
}));

const unwrapped = (fn: (args: unknown) => unknown) => (args: unknown) => ({
  unwrap: () => Promise.resolve(fn(args)),
});

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetScorecardQuery: () => ({ data: h.data.current }),
  useAnswerUnansweredMutation: () => [unwrapped(h.answer), { isLoading: false }],
  useCorrectFeedbackMutation: () => [unwrapped(h.correct), { isLoading: false }],
  useMarkFeedbackFineMutation: () => [unwrapped(h.fine), { isLoading: false }],
}));
vi.mock("../../Analytics/chartKit", () => ({ Sparkline: () => null }));

// eslint-disable-next-line import/first
import { HOME } from "../copy";
// eslint-disable-next-line import/first
import { Scorecard } from "../sections/Scorecard";

const t = HOME.scorecard;

const week = (over: Record<string, number | null> = {}) => ({
  conversations: 142,
  answers: 100,
  answeredWithSource: 91,
  declined: 12,
  wrongDeclineSuspected: 0,
  handedOver: 0,
  crisis: 1,
  thumbsUp: 9,
  thumbsDown: 1,
  answeredPct: 91,
  thumbsUpPct: 90,
  ...over,
});

const VIEW = {
  thisWeek: week(),
  lastWeek: week({ conversations: 120, answeredPct: 85, declined: 15 }),
  trend: [],
  unanswered: [{ id: "q1", question: "Do you take insurance?", at: "" }],
  thumbsDown: [
    {
      id: "f1",
      reason: "wrong_info",
      note: "It's 2000",
      at: "",
      reply: "Sessions cost 1500.",
      question: "How much is a session?",
    },
  ],
  checkup: { passed: 18, total: 20, at: "" },
};

describe("Scorecard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.data.current = VIEW;
  });

  it("says this week in plain words, against last week", () => {
    render(<Scorecard botId="b1" canEdit go={vi.fn()} />);
    expect(screen.getByTestId("scorecard-headline").textContent).toBe(
      "142 conversations. 91% answered with a source. 12 questions it didn't know.",
    );
    expect(screen.getByText("vs 120 last week")).toBeTruthy();
    expect(screen.getByText("vs 85% last week")).toBeTruthy();
    expect(screen.getByText("Last checkup: 18 of 20 answered well")).toBeTruthy();
  });

  it("shows the empty state with no conversations this week", () => {
    h.data.current = { ...VIEW, thisWeek: week({ conversations: 0 }) };
    render(<Scorecard botId="b1" canEdit go={vi.fn()} />);
    expect(screen.getByText(t.empty)).toBeTruthy();
  });

  it("Answer it saves the owner's answer", async () => {
    h.answer.mockReturnValue({ ok: true });
    render(<Scorecard botId="b1" canEdit go={vi.fn()} />);
    fireEvent.click(screen.getByText(t.answerIt));
    fireEvent.change(screen.getByLabelText(t.yourAnswer), {
      target: { value: "We give a receipt to claim." },
    });
    fireEvent.click(screen.getByText(t.save));
    await waitFor(() =>
      expect(h.answer).toHaveBeenCalledWith({
        id: "b1",
        questionId: "q1",
        text: "We give a receipt to claim.",
      }),
    );
    expect(await screen.findByText(t.saved)).toBeTruthy();
  });

  it("a thumbs-down shows what they asked, what it said and why; Correct this and It was fine", async () => {
    h.correct.mockReturnValue({ ok: true });
    h.fine.mockReturnValue({ ok: true });
    render(<Scorecard botId="b1" canEdit go={vi.fn()} />);
    expect(screen.getByText("“How much is a session?”")).toBeTruthy();
    expect(screen.getByText(/Wrong information · It's 2000/)).toBeTruthy();
    fireEvent.click(screen.getByText(t.fine));
    await waitFor(() => expect(h.fine).toHaveBeenCalledWith({ id: "b1", feedbackId: "f1" }));
    fireEvent.click(screen.getByText(t.correct));
    fireEvent.change(screen.getByLabelText(t.yourAnswer), {
      target: { value: "A session is Rs. 2,000." },
    });
    fireEvent.click(screen.getByText(t.save));
    await waitFor(() =>
      expect(h.correct).toHaveBeenCalledWith({
        id: "b1",
        feedbackId: "f1",
        text: "A session is Rs. 2,000.",
      }),
    );
  });

  it("a viewer sees the lists without the actions", () => {
    render(<Scorecard botId="b1" canEdit={false} go={vi.fn()} />);
    expect(screen.queryByText(t.answerIt)).toBeNull();
    expect(screen.queryByText(t.correct)).toBeNull();
    expect(screen.getByText("“Do you take insurance?”")).toBeTruthy();
  });
});
