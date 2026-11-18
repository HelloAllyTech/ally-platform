import "@constants";
import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import { store } from "@store";
import type { RoadmapCan, RoadmapItemDetail } from "@types";

const mockPatch = vi.fn();
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePatchRoadmapItemMutation: () => [
    (arg: unknown) => ({ unwrap: () => Promise.resolve(mockPatch(arg)) }),
    { isLoading: false },
  ],
  useGetRoadmapProductGoalsQuery: () => ({
    data: [
      { id: "g1", name: "Actor realism" },
      { id: "g2", name: "Retention" },
    ],
  }),
}));
vi.mock("../../../api/roadmapV2Flow", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetRoadmapLeadSuggestionsQuery: () => ({ data: undefined, isLoading: false, isError: false }),
  useReviewRoadmapItemMutation: () => [vi.fn()],
  useReviewRoadmapBatchMutation: () => [vi.fn()],
  useUndoRoadmapReviewMutation: () => [vi.fn()],
  useSetRoadmapLeadMutation: () => [vi.fn()],
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { BANNER_TONE, OpportunityHeader } from "../components/OpportunityHeader";
import { IdeaBannerControls, monthLabel, monthOptions } from "../components/IdeaBannerControls";

const item = (can: RoadmapCan, over: Partial<RoadmapItemDetail> = {}): RoadmapItemDetail =>
  ({
    id: "id-1",
    code: "OPP-1",
    title: "Streak",
    shownStage: "planning",
    stage: "being_built",
    goal: { id: "g1", name: "Actor realism" },
    lead: { id: 7, name: "Priya", role: "builder" },
    plannedMonth: "2026-12",
    can,
    ...over,
  }) as unknown as RoadmapItemDetail;

const wrap = (ui: React.ReactElement) =>
  render(
    <Provider store={store}>
      <MemoryRouter>{ui}</MemoryRouter>
    </Provider>,
  );

beforeEach(() => mockPatch.mockReset());

describe("month choices", () => {
  it("offers this month and the next twelve, keeps an older one, and words them", () => {
    const options = monthOptions(null, new Date(2026, 10, 18));
    expect(options[0]).toBe("2026-11");
    expect(options).toHaveLength(13);
    expect(options.at(-1)).toBe("2027-11");
    expect(monthOptions("2026-03", new Date(2026, 10, 18))[0]).toBe("2026-03");
    expect(monthLabel("2026-12")).toBe("Dec 2026");
  });
});

describe("the banner's controls follow can{}", () => {
  it("an Owner can change the goal and the planned month, saved at once", async () => {
    wrap(<IdeaBannerControls item={item({ editGoal: true, editMonth: true, editLead: true })} />);
    // The goal and month are Carbon dropdowns (the app's own listbox), not native selects.
    fireEvent.click(screen.getByRole("combobox", { name: "Goal" }));
    fireEvent.click(await screen.findByRole("option", { name: "Retention" }));
    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith({ code: "OPP-1", patch: { goalId: "g2" } }),
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Planned" }));
    fireEvent.click(await screen.findByRole("option", { name: "Unscheduled" }));
    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith({ code: "OPP-1", patch: { plannedMonth: null } }),
    );
    expect(
      screen.getByRole("button", { name: en.roadmapV2.actions.banner.changeLead("Priya") }),
    ).toBeInTheDocument();
  });

  it("someone who can't edit reads the same facts as plain text, with no controls", () => {
    wrap(<IdeaBannerControls item={item({})} />);
    expect(screen.getByText("Goal: Actor realism")).toBeInTheDocument();
    expect(screen.getByText("Lead: Priya")).toBeInTheDocument();
    expect(screen.getByText("Planned: Dec 2026")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("the banner's colour", () => {
  it("says the stage at a glance", () => {
    expect(Object.keys(BANNER_TONE).sort()).toEqual(
      ["backlog", "being_built", "declined", "draft", "shipped"].sort(),
    );
    wrap(
      <OpportunityHeader
        item={item({}, { stage: "shipped" })}
        as="h2"
        controls={<span>facts</span>}
      />,
    );
    expect(screen.getByRole("banner")).toHaveClass("bg-success-50", "sticky");
    expect(screen.getByText("facts")).toBeInTheDocument();
  });
});
