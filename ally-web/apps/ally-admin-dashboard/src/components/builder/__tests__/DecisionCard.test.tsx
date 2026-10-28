import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderDecision } from "@types";

vi.mock("@ally-ui-mono/ui-shared", async () => {
  const React = await import("react");
  return {
    Button: ({ children, onClick, disabled }: any) => (
      <button onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
    Tag: ({ children }: any) => <span>{children}</span>,
    Tile: ({ children, className, ...rest }: any) => (
      <div className={className} data-testid={rest["data-testid"]}>
        {children}
      </div>
    ),
    TextArea: React.forwardRef(({ labelText, hideLabel, ...rest }: any, ref: any) => (
      <textarea ref={ref} aria-label={labelText} {...rest} />
    )),
  };
});

// eslint-disable-next-line import/first
import { DecisionCard } from "../DecisionCard";

const decision = (overrides: Partial<BuilderDecision> = {}): BuilderDecision => ({
  id: "question:s1:q1",
  kind: "question",
  category: "what",
  sessionId: "s1",
  sessionTitle: "Weekly digest",
  sessionStatus: "INTERVIEWING",
  createdByName: "Sandeep",
  repos: ["ally-be"],
  prompt: "Monday or Friday?",
  rationale: "Both work.\nBased on: X1\nYours to decide because: the code allows either.",
  questionType: "behaviour",
  context: ["Builder said: I read the scheduler.", "PRD: A weekly digest."],
  blocked: "Scoping is paused until this is answered.",
  selection: "single",
  options: [
    { id: "fri", label: "Friday", description: "End of week." },
    { id: "mon", label: "Monday", description: "Start of week.", recommended: true },
  ],
  allowCustom: true,
  allowNone: false,
  minSelections: null,
  customPlaceholder: "Your own answer…",
  waitingSince: "2026-10-28T09:00:00Z",
  pullRequestUrl: null,
  ...overrides,
});

const renderCard = (overrides: Partial<BuilderDecision> = {}, props: Record<string, any> = {}) => {
  const onAnswer = vi.fn();
  const onSkip = vi.fn();
  const onOpenSession = vi.fn();
  render(
    <DecisionCard
      decision={decision(overrides)}
      onAnswer={onAnswer}
      onSkip={onSkip}
      onOpenSession={onOpenSession}
      busy={false}
      waitingLabel="3m ago"
      {...props}
    />,
  );
  return { onAnswer, onSkip, onOpenSession };
};

describe("DecisionCard", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("lays out the recommendation first, numbered, with the split rationale", () => {
    renderCard();

    const options = screen.getAllByRole("button", { pressed: false });
    expect(options[0]).toHaveTextContent("1");
    expect(options[0]).toHaveTextContent("Monday");
    expect(options[0]).toHaveTextContent("Recommended");
    expect(options[1]).toHaveTextContent("Friday");
    expect(screen.getByText("Based on")).toBeInTheDocument();
    expect(screen.getByText("X1")).toBeInTheDocument();
    expect(screen.getByText("the code allows either.")).toBeInTheDocument();
    expect(screen.getByText(/Scoping is paused/)).toBeInTheDocument();
    expect(screen.getByText("Waiting 3m ago")).toBeInTheDocument();
  });

  it("answers a single-select on click", () => {
    const { onAnswer } = renderCard();

    fireEvent.click(screen.getByText("Friday"));

    expect(onAnswer).toHaveBeenCalledWith({ selectedOptionIds: ["fri"] });
  });

  it("answers with the recommendation on Enter", () => {
    const { onAnswer } = renderCard();

    fireEvent.keyDown(window, { key: "Enter" });

    expect(onAnswer).toHaveBeenCalledWith({ selectedOptionIds: ["mon"] });
  });

  it("picks on a digit, and sends on the same digit again", () => {
    const { onAnswer } = renderCard();

    fireEvent.keyDown(window, { key: "2" });
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByText("Friday").closest("button")).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(window, { key: "2" });
    expect(onAnswer).toHaveBeenCalledWith({ selectedOptionIds: ["fri"] });
  });

  it("sends the pick on Enter rather than the recommendation", () => {
    const { onAnswer } = renderCard();

    fireEvent.keyDown(window, { key: "2" });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(onAnswer).toHaveBeenCalledWith({ selectedOptionIds: ["fri"] });
  });

  it("sends a custom answer from the textarea on Enter, and ignores shortcuts while typing", () => {
    const { onAnswer } = renderCard();
    const textarea = screen.getByLabelText("Your own answer");

    fireEvent.change(textarea, { target: { value: "Wednesday" } });
    // A digit typed into the field is text, not a pick.
    fireEvent.keyDown(textarea, { key: "1" });
    expect(onAnswer).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onAnswer).toHaveBeenCalledWith({
      customValues: ["Wednesday"],
      message: "Wednesday",
    });
  });

  it("gathers a multi-select and confirms it", () => {
    const { onAnswer } = renderCard({
      selection: "multi",
      options: [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
      ],
    });

    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "3" });
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Confirm"));

    expect(onAnswer).toHaveBeenCalledWith({ selectedOptionIds: ["a", "c"] });
  });

  it("offers None of these only when the agent allows it", () => {
    const { onAnswer } = renderCard({ allowNone: true });

    fireEvent.click(screen.getByText("None of these"));

    expect(onAnswer).toHaveBeenCalledWith({ none: true });
  });

  it("locks every control while the answer is in flight", () => {
    const { onAnswer } = renderCard({}, { busy: true });

    fireEvent.click(screen.getByText("Friday"));
    fireEvent.keyDown(window, { key: "Enter" });

    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByText("Sending…")).toBeInTheDocument();
  });

  it("hands the keyboard back when not active", () => {
    const { onAnswer } = renderCard({}, { active: false });

    fireEvent.keyDown(window, { key: "Enter" });

    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("folds context past three lines and links the pull request", () => {
    renderCard({
      context: ["one", "two", "three", "four", "five"],
      pullRequestUrl: "https://github.com/x/y/pull/1",
    });

    expect(screen.queryByText("four")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Show 2 more"));
    expect(screen.getByText("five")).toBeInTheDocument();
    expect(screen.getByText("Open pull request")).toHaveAttribute(
      "href",
      "https://github.com/x/y/pull/1",
    );
  });
});
