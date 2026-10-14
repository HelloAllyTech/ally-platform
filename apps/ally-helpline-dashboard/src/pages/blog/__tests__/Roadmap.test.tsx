import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RoadmapCard } from "@api";

const { mockUseGetPublicRoadmapQuery } = vi.hoisted(() => ({
  mockUseGetPublicRoadmapQuery: vi.fn(),
}));

vi.mock("@api", () => ({
  useGetPublicRoadmapQuery: () => mockUseGetPublicRoadmapQuery(),
}));

import { Roadmap } from "../Roadmap";

const card = (overrides: Partial<RoadmapCard>): RoadmapCard => ({
  id: "c1",
  title: "Learner App",
  description: "A vertical, voice-first LMS.",
  note: null,
  category: "prepare",
  stage: "beta",
  sortOrder: 0,
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/blog/roadmap"]}>
      <Roadmap />
    </MemoryRouter>,
  );

const loaded = (items: RoadmapCard[], updatedAt: string | null = "2026-10-09T00:00:00Z") =>
  mockUseGetPublicRoadmapQuery.mockReturnValue({
    data: { items, updatedAt },
    isLoading: false,
    isError: false,
  });

describe("Roadmap page", () => {
  beforeEach(() => mockUseGetPublicRoadmapQuery.mockReset());

  it("files each card under its category and stage", () => {
    loaded([
      card({ id: "a", title: "Authoring Studio", stage: "lab", note: "Current priority" }),
      card({ id: "b", title: "Field Companion", category: "perform", stage: "idea" }),
    ]);
    renderPage();

    const prepare = screen.getByRole("region", { name: "Prepare" });
    const lab = within(prepare).getByRole("heading", { level: 3, name: "Lab" }).parentElement!;
    expect(within(lab).getByRole("heading", { name: "Authoring Studio" })).toBeInTheDocument();
    expect(within(lab).getByText("Current priority")).toBeInTheDocument();

    const perform = screen.getByRole("region", { name: "Perform" });
    expect(within(perform).getByRole("heading", { name: "Field Companion" })).toBeInTheDocument();
    expect(within(perform).queryByText("Authoring Studio")).not.toBeInTheDocument();
  });

  it("gives an empty stage no heading, so the stacked layout has no orphan labels", () => {
    loaded([card({ stage: "beta" })]);
    renderPage();

    const prepare = screen.getByRole("region", { name: "Prepare" });
    expect(
      within(prepare)
        .getAllByRole("heading", { level: 3 })
        .map(h => h.textContent),
    ).toEqual(["Beta"]);
  });

  it("says so when a whole category has nothing in it", () => {
    loaded([card({ category: "prepare" })]);
    renderPage();

    expect(
      within(screen.getByRole("region", { name: "Perform" })).getByText("Nothing here yet."),
    ).toBeInTheDocument();
  });

  it("carries no date or update cadence", () => {
    loaded([card({})], "2026-10-09T00:00:00Z");
    renderPage();

    expect(screen.queryByText("October 2026")).not.toBeInTheDocument();
    expect(screen.queryByText(/Updated quarterly/)).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no cards", () => {
    loaded([], null);
    renderPage();

    expect(screen.getByText("Nothing on the roadmap yet. Check back soon!")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Prepare" })).not.toBeInTheDocument();
  });

  it("explains a failed load instead of showing an empty roadmap", () => {
    mockUseGetPublicRoadmapQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    renderPage();

    expect(
      screen.getByText("Something went wrong loading the roadmap. Please try again later."),
    ).toBeInTheDocument();
  });

  it("keeps the headline visible while the cards load", () => {
    mockUseGetPublicRoadmapQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "From the practice room to the field." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});
