import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BuilderSituationBrief } from "@types";

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Tag: ({ children }: any) => <span>{children}</span>,
  TextArea: ({ labelText, value, onChange, disabled }: any) => (
    <textarea aria-label={labelText} value={value} onChange={onChange} disabled={disabled} />
  ),
  Tile: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

// eslint-disable-next-line import/first
import { SituationBriefCard } from "../SituationBriefCard";

const brief: BuilderSituationBrief = {
  id: "brief-1",
  message: "Here is what exists.",
  lines: [
    {
      id: "X1",
      kind: "exists",
      text: "Auto-improve already tests debrief prompts",
      cites: [{ ref: "E1", label: 'capability_lookup "auto improve" — Auto-improve' }],
    },
    {
      id: "P1",
      kind: "proposal",
      approach: "new",
      part: "rating",
      text: "A thumbs rating under the debrief",
      cites: [],
    },
    { id: "R1", kind: "repo", repo: "ally-mobile", text: "the mobile DebriefTab", cites: [] },
  ],
};

const line = (id: string) => screen.getByTestId(`brief-line-${id}`);

describe("SituationBriefCard", () => {
  it("lays the brief out by section, with what each line rests on", () => {
    render(<SituationBriefCard brief={brief} onSubmit={vi.fn()} />);

    expect(screen.getByText("What I found before asking anything")).toBeInTheDocument();
    expect(screen.getByText("Already exists")).toBeInTheDocument();
    expect(screen.getByText("Proposed")).toBeInTheDocument();
    expect(screen.getByText("Where the work lands")).toBeInTheDocument();
    expect(within(line("X1")).getByText(/Auto-improve$/)).toBeInTheDocument();
    expect(within(line("P1")).getByText("New")).toBeInTheDocument();
    expect(within(line("R1")).getByText("ally-mobile")).toBeInTheDocument();
  });

  it("confirms everything in one click when nothing is wrong", () => {
    const onSubmit = vi.fn();
    render(<SituationBriefCard brief={brief} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText("Confirm all and send"));

    expect(onSubmit).toHaveBeenCalledWith(
      {
        briefId: "brief-1",
        lines: [
          { id: "X1", verdict: "confirm" },
          { id: "P1", verdict: "confirm" },
          { id: "R1", verdict: "confirm" },
        ],
      },
      "Confirmed the brief.",
    );
  });

  it("takes a correction in words, confirms the rest, and carries the note", () => {
    const onSubmit = vi.fn();
    render(<SituationBriefCard brief={brief} onSubmit={onSubmit} />);

    fireEvent.click(within(line("P1")).getByText("Correct it"));
    // A correction with no words cannot be sent.
    expect(screen.getByText(/Say what's true instead/)).toBeInTheDocument();
    expect(screen.getByText("Confirm the other 2 and send")).toBeDisabled();

    fireEvent.change(within(line("P1")).getByLabelText("What's true instead?"), {
      target: { value: "Extend the session rating instead" },
    });
    fireEvent.change(screen.getByLabelText("Anything else Builder should know? (optional)"), {
      target: { value: "Keep it cheap" },
    });
    fireEvent.click(screen.getByText("Confirm the other 2 and send"));

    expect(onSubmit).toHaveBeenCalledWith(
      {
        briefId: "brief-1",
        lines: [
          { id: "X1", verdict: "confirm" },
          { id: "P1", verdict: "correct", correction: "Extend the session rating instead" },
          { id: "R1", verdict: "confirm" },
        ],
        note: "Keep it cheap",
      },
      "Confirmed 2, corrected 1. Also: Keep it cheap",
    );
  });

  it("lets a verdict be undone", () => {
    render(<SituationBriefCard brief={brief} onSubmit={vi.fn()} />);

    fireEvent.click(within(line("X1")).getByText("Right"));
    expect(within(line("X1")).getByText("Confirmed")).toBeInTheDocument();
    fireEvent.click(within(line("X1")).getByText("Undo"));
    expect(within(line("X1")).getByText("Right")).toBeInTheDocument();
  });

  it("renders an answered brief locked, with each verdict", () => {
    render(
      <SituationBriefCard
        brief={brief}
        answered={{
          briefId: "brief-1",
          lines: [
            { id: "X1", verdict: "confirm" },
            { id: "P1", verdict: "correct", correction: "Extend the session rating instead" },
            { id: "R1", verdict: "confirm" },
          ],
          note: "Keep it cheap",
        }}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("Answered")).toBeInTheDocument();
    expect(within(line("P1")).getByText("Corrected")).toBeInTheDocument();
    expect(within(line("P1")).getByText("Extend the session rating instead")).toBeInTheDocument();
    expect(within(line("X1")).getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText("Also: Keep it cheap")).toBeInTheDocument();
    expect(screen.queryByText("Right")).toBeNull();
    expect(screen.queryByRole("button", { name: /send/i })).toBeNull();
  });
});
