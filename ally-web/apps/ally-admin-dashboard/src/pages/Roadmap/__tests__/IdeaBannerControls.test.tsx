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
import {
  IdeaBannerControls,
  monthLabel,
  monthOptions,
  releaseDateLabel,
} from "../components/IdeaBannerControls";
import { PeopleChips } from "../components/PeopleChips";

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

  it("words a release date with its year, and drops a missing one", () => {
    expect(releaseDateLabel("2026-03-12T10:00:00.000Z")).toBe("12 Mar 2026");
    expect(releaseDateLabel(null)).toBe("");
    expect(releaseDateLabel("not a date")).toBe("");
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

  it("an Owner sizes the idea, and clears the size with Not sized", async () => {
    wrap(<IdeaBannerControls item={item({ editSize: true }, { size: "m" })} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Size" }));
    fireEvent.click(await screen.findByRole("option", { name: "XL" }));
    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith({ code: "OPP-1", patch: { size: "xl" } }),
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Size" }));
    fireEvent.click(await screen.findByRole("option", { name: "Not sized" }));
    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith({ code: "OPP-1", patch: { size: null } }),
    );
  });

  it("someone who can't edit reads the same facts as plain text, with no controls", () => {
    wrap(
      <IdeaBannerControls item={item({}, { size: "l", releasedAt: "2026-03-12T10:00:00.000Z" })} />,
    );
    expect(screen.getByText("Goal: Actor realism")).toBeInTheDocument();
    expect(screen.getByText("Planned: Dec 2026")).toBeInTheDocument();
    expect(screen.getByText("Size: L")).toBeInTheDocument();
    expect(screen.getByText("Released: 12 Mar 2026")).toBeInTheDocument();
    // The builder is named once, in the people line under the banner, not here too.
    expect(screen.queryByText(/Builder: Priya/)).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("the people line", () => {
  it("names the submitter and the builder", () => {
    wrap(
      <PeopleChips
        item={item({}, { stage: "being_built", author: { id: 3, name: "Ravi", role: "idea" } })}
      />,
    );
    expect(screen.getByText("Submitted by")).toBeInTheDocument();
    expect(screen.getByText("Builder:")).toBeInTheDocument();
    expect(screen.getByText("Priya")).toBeInTheDocument();
  });

  it("says No builder yet until one is assigned, but not once it is Not building", () => {
    const { unmount } = wrap(
      <PeopleChips item={item({}, { stage: "backlog", lead: undefined })} />,
    );
    expect(screen.getByText("No builder yet")).toBeInTheDocument();
    unmount();
    wrap(<PeopleChips item={item({}, { stage: "declined", lead: undefined })} />);
    expect(screen.queryByText("No builder yet")).toBeNull();
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
