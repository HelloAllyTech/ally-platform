import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BuilderTurnReceipt } from "@types";

import { TurnReceipt } from "../TurnReceipt";

const receipt = (overrides: Partial<BuilderTurnReceipt> = {}): BuilderTurnReceipt => ({
  read: [],
  searched: [],
  changed: [],
  prdVersion: { from: 4, to: 4 },
  failed: [],
  warnings: [],
  ...overrides,
});

const busy = receipt({
  read: ["ally-be/src/builder/x.ts", "wiki/platform/architecture.md", "Stacks: 2 chunks"],
  searched: ['Code search "debrief rating" — 4 matches', 'Docs search "XP" — 1 match'],
  changed: ["Requirements: added R4; revised R2", "Repo plan: ally-be"],
  prdVersion: { from: 7, to: 9 },
});

describe("TurnReceipt", () => {
  describe("the summary line", () => {
    it("counts what the turn read, searched and changed, and the PRD version it moved to", () => {
      render(<TurnReceipt receipt={busy} />);

      expect(
        screen.getByText("Read 3 · Searched 2 · Changed 2 sections · PRD v7 → v9"),
      ).toBeInTheDocument();
    });

    it("leaves out a group that is zero, and says 'section' for one", () => {
      render(
        <TurnReceipt receipt={receipt({ changed: ["Summary"], prdVersion: { from: 1, to: 1 } })} />,
      );

      expect(screen.getByText("Changed 1 section")).toBeInTheDocument();
    });

    it("says so when nothing was looked up and the PRD did not move", () => {
      render(<TurnReceipt receipt={receipt()} />);

      expect(screen.getByText("No lookups, PRD unchanged")).toBeInTheDocument();
    });

    it("does not say 'no lookups' about a turn whose only lookup failed", () => {
      render(
        <TurnReceipt receipt={receipt({ failed: ["Read ally-be/src/gone.ts — Not Found"] })} />,
      );

      expect(screen.queryByText(/No lookups/)).not.toBeInTheDocument();
      expect(screen.getByText("Read ally-be/src/gone.ts — Not Found")).toBeInTheDocument();
    });
  });

  describe("failures, warnings and why the PRD did not change", () => {
    const troubled = receipt({
      read: ["ally-be/src/builder/x.ts"],
      failed: ["Read ally-be/src/gone.ts — Not Found", "Edit R3 — requirement not found"],
      warnings: ["Builder said the PRD changed, but no edit landed this turn."],
      prdUnchangedBecause: "You asked me to hold off until the design is agreed.",
    });

    it("shows them without opening the details", () => {
      render(<TurnReceipt receipt={troubled} />);

      for (const line of [
        "Read ally-be/src/gone.ts — Not Found",
        "Edit R3 — requirement not found",
        "Builder said the PRD changed, but no edit landed this turn.",
        "PRD unchanged: You asked me to hold off until the design is agreed.",
      ]) {
        const element = screen.getByText(line);
        expect(element).toBeVisible();
        expect(element.closest("details")).toBeNull();
      }
    });

    it("labels them in words, not only colour", () => {
      render(<TurnReceipt receipt={troubled} />);

      expect(screen.getByText("Failed")).toBeInTheDocument();
      expect(screen.getByText("Delivered with warnings")).toBeInTheDocument();
    });

    it("gives a reason the PRD stood still its own line, without repeating 'PRD unchanged' in the summary", () => {
      render(
        <TurnReceipt receipt={receipt({ prdUnchangedBecause: "You only asked a question." })} />,
      );

      expect(screen.getByText("No lookups")).toBeInTheDocument();
      expect(screen.getByText("PRD unchanged: You only asked a question.")).toBeInTheDocument();
      expect(screen.queryByText("No lookups, PRD unchanged")).not.toBeInTheDocument();
    });

    it("keeps a failure that was filed as a bare string rather than a list", () => {
      render(<TurnReceipt receipt={{ ...receipt(), failed: "Read x.ts — Not Found" } as never} />);

      expect(screen.getByText("Read x.ts — Not Found")).toBeVisible();
    });
  });

  describe("the details", () => {
    it("holds the read, searched and changed lists, closed until asked for", () => {
      render(<TurnReceipt receipt={busy} />);

      expect(screen.getByText("ally-be/src/builder/x.ts")).not.toBeVisible();
      expect(screen.getByText('Code search "debrief rating" — 4 matches')).not.toBeVisible();
      expect(screen.getByText("Requirements: added R4; revised R2")).not.toBeVisible();
    });

    it("opens from the summary", () => {
      render(<TurnReceipt receipt={busy} />);

      fireEvent.click(screen.getByText(/^Read 3/));

      expect(screen.getByText("ally-be/src/builder/x.ts")).toBeVisible();
      expect(screen.getByText('Code search "debrief rating" — 4 matches')).toBeVisible();
      expect(screen.getByText("Requirements: added R4; revised R2")).toBeVisible();
      expect(screen.getByText("Changed in the PRD")).toBeVisible();
    });

    it("sets file paths in monospace", () => {
      render(<TurnReceipt receipt={busy} />);

      expect(screen.getByText("ally-be/src/builder/x.ts").closest("ul")).toHaveClass("font-mono");
      expect(screen.getByText("Requirements: added R4; revised R2").closest("ul")).not.toHaveClass(
        "font-mono",
      );
    });

    it("has no toggle at all when there is nothing behind it", () => {
      const { container } = render(
        <TurnReceipt receipt={receipt({ failed: ["Read x.ts — Not Found"] })} />,
      );

      expect(container.querySelector("details")).toBeNull();
    });
  });

  describe("something that is not a receipt", () => {
    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a string", "all good"],
      ["an array", [busy]],
      ["an empty object", {}],
      ["an object with no lists", { prdVersion: { from: 1, to: 2 }, prdUnchangedBecause: "x" }],
      ["lists that are not arrays", { read: "a", searched: 1, changed: {}, failed: "b" }],
    ])("renders nothing for %s", (_name, value) => {
      const { container } = render(<TurnReceipt receipt={value as never} />);

      expect(container).toBeEmptyDOMElement();
    });

    it("survives entries that are not strings and a version that is not numbers", () => {
      render(
        <TurnReceipt
          receipt={
            {
              read: [{ text: "ally-be/src/x.ts" }, null, 42],
              searched: [],
              changed: [],
              failed: [],
              warnings: [],
              prdVersion: { from: "7", to: null },
            } as never
          }
        />,
      );

      expect(screen.getByText(/^Read 2/)).toBeInTheDocument();
      expect(screen.queryByText(/PRD v/)).not.toBeInTheDocument();
    });
  });
});
