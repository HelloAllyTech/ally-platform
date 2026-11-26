import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QuizAttemptResult, SanitizedQuizQuestion } from "../../../../../../types/tracks";
import { QuizResults } from "../QuizResults";

vi.mock("@assets", () => ({
  ArrowDownFilled: () => <span />,
  TickGreenBackground: () => <span data-testid="tick-icon" />,
  CrossRedBackground: () => <span data-testid="cross-icon" />,
}));

vi.mock("@components", () => ({
  CircularProgress: ({ current }: { current: number }) => (
    <span data-testid="score-ring">{current}</span>
  ),
}));

const mcq: SanitizedQuizQuestion = {
  id: "mcq",
  type: "mcq_single",
  prompt: "What comes first?",
  points: 1,
  graded: true,
  options: [
    { id: "a", text: "Listen" },
    { id: "b", text: "Advise" },
  ],
};

/** What the server sends for a graded quiz with no pass mark and answers hidden. */
const hiddenResult = (overrides: Partial<QuizAttemptResult> = {}): QuizAttemptResult => ({
  attemptId: "att-1",
  attemptNumber: 1,
  status: "GRADED",
  scorePct: null,
  passed: true,
  feedbackHidden: true,
  passScore: 0,
  attemptsUsed: 1,
  maxAttempts: null,
  questions: [
    { questionId: "mcq", correct: null, graded: true, pointsAwarded: 0, pointsPossible: 1 },
  ],
  itemCompleted: true,
  unlockedItemIds: [],
  sectionCompleted: false,
  trackCompleted: false,
  ...overrides,
});

const renderResults = (result: QuizAttemptResult, onNext = vi.fn()) =>
  render(
    <QuizResults
      result={result}
      questions={[mcq]}
      answers={{}}
      isRegrading={false}
      canRetry
      onRegrade={vi.fn()}
      onRetry={vi.fn()}
      onNext={onNext}
    />,
  );

describe("QuizResults - feedback hidden", () => {
  it("says the answers were recorded, and nothing about how the learner did", () => {
    renderResults(hiddenResult());
    expect(screen.getByText("Responses submitted")).toBeInTheDocument();
    expect(screen.queryByTestId("score-ring")).not.toBeInTheDocument();
    expect(screen.queryByText("Passed")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tick-icon")?.closest("li, button")).toBeNull();
    expect(screen.queryByTestId("cross-icon")).not.toBeInTheDocument();
    // No "0/1" points and no "Not scored" label on the question row.
    expect(screen.queryByText("0/1")).not.toBeInTheDocument();
    expect(screen.queryByText("Not scored")).not.toBeInTheDocument();
  });

  it("shows no verdict when a question is opened", () => {
    renderResults(hiddenResult());
    fireEvent.click(screen.getByRole("button", { name: /What comes first/ }));
    expect(screen.queryByText("Correct")).not.toBeInTheDocument();
    expect(screen.queryByText("Incorrect")).not.toBeInTheDocument();
  });

  it("moves on with Next, not Finish grading", () => {
    const onNext = vi.fn();
    renderResults(hiddenResult(), onNext);
    expect(screen.queryByText("Finish grading")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onNext).toHaveBeenCalled();
  });

  it("still offers Finish grading while the AI grader has not finished", () => {
    renderResults(hiddenResult({ status: "PENDING_GRADING", passed: null, itemCompleted: false }));
    expect(screen.getByRole("button", { name: "Finish grading" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });
});
