import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import type { CourseCopilotQuestionEvent } from "@types";

import { AgentOptionPickerProps, QuestionCard } from "../QuestionCard";

const strings = en.agentChat.question;

const single = (
  overrides: Partial<CourseCopilotQuestionEvent> = {},
): CourseCopilotQuestionEvent => ({
  id: "q1",
  prompt: "Who is this course for?",
  kind: "singleSelect",
  options: [
    { id: "o1", label: "Experienced counsellors" },
    {
      id: "o2",
      label: "New volunteers",
      description: "First month on a helpline",
      recommended: true,
    },
  ],
  allowCustom: true,
  allowNone: true,
  rationale: "It decides how much background to explain.",
  ...overrides,
});

describe("agent-chat QuestionCard", () => {
  it("shows the rationale and puts the recommended option first, marked", () => {
    render(<QuestionCard question={single()} onAnswer={vi.fn()} />);

    expect(screen.getByText("It decides how much background to explain.")).toBeInTheDocument();
    const buttons = screen
      .getAllByRole("button")
      .filter(
        button =>
          button.textContent?.includes("volunteers") || button.textContent?.includes("counsellors"),
      );
    expect(buttons[0].textContent).toContain("New volunteers");
    expect(buttons[0].textContent).toContain(strings.recommended);
    expect(screen.getByText("First month on a helpline")).toBeInTheDocument();
  });

  it("answers a single-select in one click with the option's id", () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={single()} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByText("New volunteers"));

    expect(onAnswer).toHaveBeenCalledWith({
      message: "New volunteers",
      questionId: "q1",
      answer: { selectedOptionIds: ["o2"] },
    });
    // Locks to what was said.
    expect(screen.getByText(strings.answeredLabel)).toBeInTheDocument();
  });

  it("answers 'None of these' with the none flag", () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={single()} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByText(strings.noneOfThese));

    expect(onAnswer).toHaveBeenCalledWith({
      message: strings.noneOfThese,
      questionId: "q1",
      answer: { none: true },
    });
  });

  it("answers with the trainer's own words", () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={single()} onAnswer={onAnswer} />);

    fireEvent.change(screen.getByPlaceholderText(strings.addCustomPlaceholder), {
      target: { value: "Peer supporters" },
    });
    fireEvent.click(screen.getByText(strings.add));

    expect(onAnswer).toHaveBeenCalledWith({
      message: "Peer supporters",
      questionId: "q1",
      answer: { customValues: ["Peer supporters"] },
    });
  });

  it("collects a multi-select and confirms it in one answer", () => {
    const onAnswer = vi.fn();
    render(
      <QuestionCard
        question={single({ kind: "multiSelect", allowCustom: false, allowNone: false })}
        onAnswer={onAnswer}
      />,
    );

    expect(screen.getByText(strings.confirmSelection).closest("button")).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Experienced counsellors/));
    fireEvent.click(screen.getByLabelText(/New volunteers/));
    fireEvent.click(screen.getByText(strings.confirmSelection));

    expect(onAnswer).toHaveBeenCalledWith({
      message: "Experienced counsellors, New volunteers",
      questionId: "q1",
      answer: { selectedOptionIds: ["o1", "o2"] },
    });
  });

  it("submits a free-text answer with Enter", () => {
    const onAnswer = vi.fn();
    render(
      <QuestionCard
        question={{ id: "q2", prompt: "What should learners be able to do?", kind: "freeText" }}
        onAnswer={onAnswer}
      />,
    );

    const box = screen.getByPlaceholderText(strings.freeTextPlaceholder);
    fireEvent.change(box, { target: { value: "Hold a safety conversation" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(onAnswer).toHaveBeenCalledWith({
      message: "Hold a safety conversation",
      questionId: "q2",
    });
  });

  it("opens locked, with the answer shown, when resumed from a transcript", () => {
    render(
      <QuestionCard
        question={single()}
        answeredAnswer={{ selectedOptionIds: ["o1"] }}
        onAnswer={vi.fn()}
      />,
    );

    expect(screen.getByText("Experienced counsellors", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText(strings.answeredLabel)).toBeInTheDocument();
  });

  it("unlocks again when the turn was refused, so the answer can be given again", async () => {
    // The server's turn mutex was still held: nothing of the answer was recorded.
    const onAnswer = vi.fn().mockResolvedValue(false);
    render(<QuestionCard question={single()} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByText("New volunteers"));

    await waitFor(() => expect(screen.queryByText(strings.answeredLabel)).not.toBeInTheDocument());
    expect(screen.getByText("New volunteers")).toBeInTheDocument();
  });

  it("stays locked when the turn was accepted", async () => {
    const onAnswer = vi.fn().mockResolvedValue(true);
    render(<QuestionCard question={single()} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByText("New volunteers"));
    await Promise.resolve();

    expect(screen.getByText(strings.answeredLabel)).toBeInTheDocument();
  });

  // The agent authors `options`; a string there crashed Builder's panel once.
  it("renders a question whose options are not an array", () => {
    render(<QuestionCard question={single({ options: "nope" as never })} onAnswer={vi.fn()} />);
    expect(screen.getByText("Who is this course for?")).toBeInTheDocument();
  });

  it("does not let a disabled card be answered", () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={single()} onAnswer={onAnswer} disabled />);

    fireEvent.click(screen.getByText("New volunteers"));

    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("offers None of these on a dropdown that allows it", () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={single({ kind: "dropdown" })} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByLabelText(strings.noneOfThese));
    fireEvent.click(screen.getByText(strings.confirmSelection));

    expect(onAnswer).toHaveBeenCalledWith({
      message: strings.noneOfThese,
      questionId: "q1",
      answer: { none: true },
    });
  });

  // Builder pins a mid-build pause's questions above the feed; the mark says "this is waiting on
  // you" and goes once it no longer is.
  describe("emphasised", () => {
    const tileOf = (prompt: string) => screen.getByText(prompt).parentElement as HTMLElement;

    it("marks the card until it is answered", () => {
      render(<QuestionCard question={single()} onAnswer={vi.fn()} emphasised />);
      expect(tileOf("Who is this course for?").className).toContain("border-l-primary-500");

      fireEvent.click(screen.getByText("New volunteers"));
      expect(tileOf("Who is this course for?").className).not.toContain("border-l-primary-500");
    });

    it("leaves an inline card unmarked", () => {
      render(<QuestionCard question={single()} onAnswer={vi.fn()} />);
      expect(tileOf("Who is this course for?").className).not.toContain("border-l-primary-500");
    });
  });

  describe("strings", () => {
    it("uses a feature's own wording where given, and the shared wording elsewhere", () => {
      const onAnswer = vi.fn();
      render(
        <QuestionCard
          question={{ id: "q3", prompt: "Her age?", kind: "freeText" }}
          onAnswer={onAnswer}
          strings={{ submitAnswer: "Submit answer", freeTextPlaceholder: "Type your answer…" }}
        />,
      );

      fireEvent.change(screen.getByPlaceholderText("Type your answer…"), {
        target: { value: "34" },
      });
      fireEvent.click(screen.getByText("Submit answer"));

      expect(onAnswer).toHaveBeenCalledWith({ message: "34", questionId: "q3" });
      // Not overridden, so the shared label.
      expect(screen.getByText(strings.answeredLabel)).toBeInTheDocument();
    });
  });

  // A feature can draw the options itself (the interview's playable voice rows) while the card
  // keeps the answering contract.
  describe("renderOptions", () => {
    const picker = vi.fn(({ options, selected, onSelect, disabled }: AgentOptionPickerProps) => (
      <ul>
        {options.map(option => (
          <li key={option.id}>
            <button type="button" disabled={disabled} onClick={() => onSelect(option.id)}>
              pick {option.label}
            </button>
            {selected.includes(option.id) && <span>picked {option.label}</span>}
          </li>
        ))}
      </ul>
    ));

    it("draws the options through it instead of the card's own list", () => {
      render(<QuestionCard question={single()} onAnswer={vi.fn()} renderOptions={picker} />);

      expect(screen.getByText("pick New volunteers")).toBeInTheDocument();
      // The card's own option rows (which carry the recommended badge) are not drawn.
      expect(screen.queryByText(strings.recommended)).not.toBeInTheDocument();
    });

    it("answers a singleSelect on the pick", () => {
      const onAnswer = vi.fn();
      render(<QuestionCard question={single()} onAnswer={onAnswer} renderOptions={picker} />);

      fireEvent.click(screen.getByText("pick Experienced counsellors"));

      expect(onAnswer).toHaveBeenCalledWith({
        message: "Experienced counsellors",
        questionId: "q1",
        answer: { selectedOptionIds: ["o1"] },
      });
    });

    it("keeps a confirm kind's pick single, so a second pick replaces the first", () => {
      const onAnswer = vi.fn();
      render(
        <QuestionCard
          question={single({ kind: "multiSelect" })}
          onAnswer={onAnswer}
          renderOptions={picker}
        />,
      );

      fireEvent.click(screen.getByText("pick Experienced counsellors"));
      fireEvent.click(screen.getByText("pick New volunteers"));
      expect(screen.queryByText("picked Experienced counsellors")).not.toBeInTheDocument();
      fireEvent.click(screen.getByText(strings.confirmSelection));

      expect(onAnswer).toHaveBeenCalledWith({
        message: "New volunteers",
        questionId: "q1",
        answer: { selectedOptionIds: ["o2"] },
      });
    });

    it("still offers None of these alongside it", () => {
      const onAnswer = vi.fn();
      render(
        <QuestionCard
          question={single({ kind: "dropdown" })}
          onAnswer={onAnswer}
          renderOptions={picker}
        />,
      );

      fireEvent.click(screen.getByLabelText(strings.noneOfThese));
      fireEvent.click(screen.getByText(strings.confirmSelection));

      expect(onAnswer.mock.calls[0][0].answer).toEqual({ none: true });
    });

    it("is not used for a free-text question", () => {
      render(
        <QuestionCard
          question={{ id: "q2", prompt: "Anything else?", kind: "freeText" }}
          onAnswer={vi.fn()}
          renderOptions={picker}
        />,
      );
      expect(screen.getByPlaceholderText(strings.freeTextPlaceholder)).toBeInTheDocument();
    });
  });
});
