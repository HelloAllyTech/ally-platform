import "@constants";
import React from "react";

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import type { RoadmapItemDetail } from "@types";

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePatchRoadmapItemMutation: () => [vi.fn()],
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { OpportunityHeader } from "../components/OpportunityHeader";

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
  it("always shows the code and the whole title, wrapped, with no stage chip and no collapse", () => {
    wrap(<OpportunityHeader item={item(LONG)} as="h1" />);
    expect(screen.getByText("OPP-0206")).toBeInTheDocument();
    // The stage lives in the tracker row and the banner colour, not in a chip beside the code.
    expect(screen.queryByText(en.roadmapV2.stages.accepted)).not.toBeInTheDocument();
    const heading = screen.getByRole("heading", { level: 1, name: LONG });
    expect(heading).not.toHaveClass("truncate");
    expect(heading.querySelector(".truncate")).toBeNull();
    expect(screen.queryByRole("button", { name: en.roadmapV2.idea.titleShow })).toBeNull();
  });

  it("shows the title editor straight away, in full, for someone who may edit it", () => {
    wrap(<OpportunityHeader item={item(LONG, true)} as="h2" />);
    expect(screen.getByRole("textbox", { name: en.roadmapV2.actions.editTitle })).toHaveValue(LONG);
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
