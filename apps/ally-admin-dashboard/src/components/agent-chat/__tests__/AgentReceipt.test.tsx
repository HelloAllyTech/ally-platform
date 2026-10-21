import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentReceipt } from "../AgentReceipt";

const receipt = (overrides: Record<string, unknown> = {}) => ({
  read: [],
  searched: [],
  changed: [],
  failed: [],
  warnings: [],
  ...overrides,
});

describe("AgentReceipt", () => {
  it("summarises the non-zero groups on one line and folds the lists away", () => {
    render(
      <AgentReceipt
        receipt={receipt({
          read: ["Guidance: Progressive Disclosure"],
          searched: ['Library search "listening" — 4 matches', "Languages — 3 languages"],
          changed: ["Brief: audience"],
        })}
      />,
    );

    const summary = screen.getByText("Read 1 · Searched 2 · 1 change");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(summary);
    expect(screen.getByText("Brief: audience")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "What this turn did" })).toBeInTheDocument();
  });

  it("keeps failures, warnings and the reason nothing changed on screen", () => {
    render(
      <AgentReceipt
        receipt={receipt({
          failed: ["Publish the course — Not ready to publish yet"],
          warnings: ["Course Copilot said something changed, but nothing did this turn."],
          unchangedBecause: "they asked how publishing works",
        })}
      />,
    );

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Publish the course — Not ready to publish yet")).toBeVisible();
    expect(screen.getByText("Delivered with warnings")).toBeInTheDocument();
    expect(
      screen.getByText("Nothing changed: they asked how publishing works"),
    ).toBeInTheDocument();
    // A failed lookup is not "no lookups".
    expect(screen.queryByText("No lookups")).toBeNull();
  });

  it("says a quiet turn was quiet", () => {
    render(<AgentReceipt receipt={receipt()} />);
    expect(screen.getByText("No lookups, nothing changed")).toBeInTheDocument();
  });

  it("takes an agent's own wording and an extra summary group", () => {
    render(
      <AgentReceipt
        receipt={receipt({ changed: ["Requirements: added R4"] })}
        strings={{ changed: () => "Changed 1 section" }}
        extraSummary="PRD v7 → v9"
      />,
    );
    expect(screen.getByText("Changed 1 section · PRD v7 → v9")).toBeInTheDocument();
  });

  it("draws nothing for something that is not a receipt, and keeps a lone string as a line", () => {
    const { container: notOne } = render(<AgentReceipt receipt={{ read: "nope" }} />);
    expect(notOne).toBeEmptyDOMElement();
    const { container: text } = render(<AgentReceipt receipt="not a receipt" />);
    expect(text).toBeEmptyDOMElement();

    render(<AgentReceipt receipt={{ read: [], failed: "Publish the course — not ready" }} />);
    expect(screen.getByText("Publish the course — not ready")).toBeInTheDocument();
  });
});
