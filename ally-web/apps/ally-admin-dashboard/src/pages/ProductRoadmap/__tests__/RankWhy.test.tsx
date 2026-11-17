import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RoadmapOpportunity } from "@types";

import { RankExplainContext, RankWhy } from "../RankWhy";

const opp = {
  priorityScore: 0,
  voterCount: 0,
  effort: null,
  goalsHelped: 0,
  goalsTotal: 0,
  compositeScore: 12.5,
} as unknown as RoadmapOpportunity;

describe("RankWhy", () => {
  it("renders nothing without weights", () => {
    const { container } = render(<RankWhy opportunity={opp} />);
    expect(container.firstChild).toBeNull();
  });

  it("opens a breakdown that names the unsized and no-votes cases", () => {
    render(
      <RankExplainContext.Provider
        value={{
          weights: {
            votesWeight: 40,
            votersWeight: 20,
            effortWeight: 20,
            goalImpactWeight: 20,
            starWeight: 0,
          },
          maxScore: 100,
        }}
      >
        <RankWhy opportunity={opp} />
      </RankExplainContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Why this rank?" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Not sized: counted as 50.")).toBeTruthy();
    expect(screen.getByText(/No votes yet/)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
