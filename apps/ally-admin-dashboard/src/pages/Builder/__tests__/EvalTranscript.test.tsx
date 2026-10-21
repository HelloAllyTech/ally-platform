import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BuilderEvalTurnRecord } from "@types";

vi.mock("@components", () => ({ cellTypes: {} }));

// eslint-disable-next-line import/first
import { en } from "@constants";

// eslint-disable-next-line import/first
import { EvalTranscript } from "../eval/EvalTranscript";

const strings = en.builder.eval.transcript;

const turns: BuilderEvalTurnRecord[] = [
  {
    turn: 1,
    admin: "A weekly digest email",
    builder: "Let me look at what exists.",
    question: "Who receives it?",
    toolCalls: [
      { name: "read_file", ok: true, summary: "ally-be/src/digest/digest.service.ts" },
      { name: "update_prd", ok: false, summary: "section not found: requirements" },
    ],
  },
  {
    turn: 2,
    admin: "No: it should reuse the existing digest job.",
    correction: true,
    builder: "I've updated the PRD.",
    toolCalls: [],
  },
];

const open = () =>
  fireEvent.click(screen.getByRole("button", { name: strings.show(turns.length) }));

describe("EvalTranscript", () => {
  it("starts collapsed, with the number of turns on the button", () => {
    render(<EvalTranscript turns={turns} />);

    expect(screen.getByRole("button", { name: strings.show(2) })).toBeInTheDocument();
    expect(screen.queryByText("A weekly digest email")).not.toBeInTheDocument();
  });

  it("opens to the turns, admin first, then Builder, then the question", () => {
    render(<EvalTranscript turns={turns} />);
    open();

    const first = screen.getByText(strings.turn(1)).closest("li") as HTMLElement;
    const text = first.textContent ?? "";
    expect(text.indexOf("A weekly digest email")).toBeGreaterThan(-1);
    expect(text.indexOf("A weekly digest email")).toBeLessThan(
      text.indexOf("Let me look at what exists."),
    );
    expect(text.indexOf("Let me look at what exists.")).toBeLessThan(
      text.indexOf("Who receives it?"),
    );
    expect(within(first).getByText(strings.question)).toBeInTheDocument();
  });

  it("marks a failed tool call in words, and leaves a successful one unmarked", () => {
    render(<EvalTranscript turns={turns} />);
    open();

    const first = screen.getByText(strings.turn(1)).closest("li") as HTMLElement;
    const failed = within(first).getByText("update_prd").closest("li") as HTMLElement;
    const succeeded = within(first).getByText("read_file").closest("li") as HTMLElement;

    expect(within(failed).getByText(strings.failed)).toBeInTheDocument();
    expect(within(failed).getByText("section not found: requirements")).toBeInTheDocument();
    expect(within(succeeded).queryByText(strings.failed)).not.toBeInTheDocument();
  });

  it("highlights the turn where the simulated admin corrected Builder", () => {
    render(<EvalTranscript turns={turns} />);
    open();

    const second = screen.getByText(strings.turn(2)).closest("li") as HTMLElement;
    expect(within(second).getByText(strings.correctionTag)).toBeInTheDocument();
    expect(within(second).getByText(strings.adminCorrects)).toBeInTheDocument();

    const first = screen.getByText(strings.turn(1)).closest("li") as HTMLElement;
    expect(within(first).queryByText(strings.correctionTag)).not.toBeInTheDocument();
    expect(within(first).queryByText(strings.adminCorrects)).not.toBeInTheDocument();
  });

  it("closes again", () => {
    render(<EvalTranscript turns={turns} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: strings.hide }));

    expect(screen.queryByText("A weekly digest email")).not.toBeInTheDocument();
  });

  it("says so when no transcript was recorded", () => {
    const { rerender } = render(<EvalTranscript turns={null} />);
    expect(screen.getByText(strings.none)).toBeInTheDocument();

    rerender(<EvalTranscript turns={[]} />);
    expect(screen.getByText(strings.none)).toBeInTheDocument();

    // Stored JSON that is not a list is not a transcript either.
    rerender(<EvalTranscript turns={{ turn: 1 } as never} />);
    expect(screen.getByText(strings.none)).toBeInTheDocument();
  });

  it("renders a transcript an agent wrote badly instead of crashing on it", () => {
    const malformed = [
      null,
      "turn one",
      {
        turn: 3,
        admin: { text: "an object where a string belongs" },
        builder: ["two", "lines"],
        question: null,
        toolCalls: "read_file",
      },
      { turn: 4, admin: "ok", builder: "ok", toolCalls: [null, { name: 7, ok: false }] },
    ] as unknown as BuilderEvalTurnRecord[];

    render(<EvalTranscript turns={malformed} />);
    fireEvent.click(screen.getByRole("button", { name: strings.show(2) }));

    expect(screen.getByText("an object where a string belongs")).toBeInTheDocument();
    expect(screen.getByText(/two\s+lines/)).toBeInTheDocument();
    // A call with no readable name still shows, as a failure.
    const fourth = screen.getByText(strings.turn(4)).closest("li") as HTMLElement;
    expect(within(fourth).getByText(strings.failed)).toBeInTheDocument();
  });
});
