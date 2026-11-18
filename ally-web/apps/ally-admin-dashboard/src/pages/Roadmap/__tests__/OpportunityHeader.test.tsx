import "@constants";
import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import type { RoadmapItemDetail } from "@types";

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePatchRoadmapItemMutation: () => [vi.fn()],
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { CollapsibleTitle, OpportunityHeader } from "../components/OpportunityHeader";

const LONG =
  "Create proper memory for agents in cases where we continue conversations in multiple sessions using an architecture similar to this https://example.com/a/very/long/path";

const item = (title: string, editTitle = false): RoadmapItemDetail =>
  ({
    id: "id-1",
    code: "OPP-0206",
    title,
    shownStage: "accepted",
    statusParts: { stage: "accepted", leadUserId: null, needsLead: true, votes: 3 },
    can: { editTitle },
  }) as unknown as RoadmapItemDetail;

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("OpportunityHeader — the card's grounding strip", () => {
  it("always shows the code, the stage word and the full title text", () => {
    wrap(<OpportunityHeader item={item(LONG)} as="h1" />);
    expect(screen.getByText("OPP-0206")).toBeInTheDocument();
    expect(screen.getByText(en.roadmapV2.stages.accepted)).toBeInTheDocument();
    // Collapsed is one truncated line, but the whole text is in the DOM and in the tooltip.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(LONG);
    expect(screen.getByTitle(LONG)).toHaveClass("truncate");
  });

  it("is pinned with position: sticky and renders its rows and actions", () => {
    wrap(
      <OpportunityHeader item={item("Short")} as="h2" actions={<span>act</span>}>
        <p>row</p>
      </OpportunityHeader>,
    );
    expect(screen.getByRole("banner")).toHaveClass("sticky", "top-0");
    expect(screen.getByText("act")).toBeInTheDocument();
    expect(screen.getByText("row")).toBeInTheDocument();
  });
});

describe("CollapsibleTitle", () => {
  it("starts collapsed and expands to the full wrapped title, then collapses", () => {
    wrap(<CollapsibleTitle item={item(LONG)} as="h2" />);
    const show = screen.getByRole("button", { name: en.roadmapV2.idea.titleShow });
    expect(show).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(show);
    const hide = screen.getByRole("button", { name: en.roadmapV2.idea.titleHide });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    // Expanded, a title the person cannot edit is a plain wrapping heading with no truncation.
    expect(screen.getByRole("heading", { name: LONG })).not.toHaveClass("truncate");
    fireEvent.click(hide);
    expect(screen.getByTitle(LONG)).toBeInTheDocument();
  });

  it("opens the title editor when expanded, for someone who may edit it", () => {
    wrap(<CollapsibleTitle item={item(LONG, true)} as="h2" />);
    expect(screen.queryByRole("textbox")).toBeNull();
    // The title itself and the chevron both open it.
    fireEvent.click(screen.getByRole("button", { name: en.roadmapV2.idea.titleShow }));
    expect(screen.getByRole("textbox", { name: en.roadmapV2.actions.editTitle })).toHaveValue(LONG);
  });

  it("collapses again when a different card opens", () => {
    const { rerender } = wrap(<CollapsibleTitle item={item(LONG)} as="h2" />);
    fireEvent.click(screen.getByRole("button", { name: en.roadmapV2.idea.titleShow }));
    rerender(
      <MemoryRouter>
        <CollapsibleTitle item={{ ...item("Another"), code: "OPP-0207" }} as="h2" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: en.roadmapV2.idea.titleShow })).toBeInTheDocument();
  });
});
