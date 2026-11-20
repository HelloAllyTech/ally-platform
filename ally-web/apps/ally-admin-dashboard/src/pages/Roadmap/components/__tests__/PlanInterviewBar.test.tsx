import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RoadmapItemDetail } from "@types";

import { PlanInterviewBar } from "../PlanInterviewBar";

const ask = vi.fn(() => ({ unwrap: async () => ({}) }));
const take = vi.fn(() => ({ unwrap: async () => ({}) }));
const release = vi.fn(() => ({ unwrap: async () => ({}) }));

vi.mock("../../../../api/roadmapV2Flow", () => ({
  useAskRoadmapOwnerToPlanMutation: () => [ask, { isLoading: false }],
  useTakeRoadmapPlanningMutation: () => [take, { isLoading: false }],
  useReleaseRoadmapPlanningMutation: () => [release, { isLoading: false }],
}));

const item = (
  can: RoadmapItemDetail["can"],
  extra: Partial<RoadmapItemDetail> = {},
): RoadmapItemDetail =>
  ({ code: "OPP-0001", shownStage: "planning", can, ...extra }) as RoadmapItemDetail;

describe("PlanInterviewBar", () => {
  beforeEach(() => vi.clearAllMocks());

  it("nudges the author to ask the product owner, before planning starts", async () => {
    render(<PlanInterviewBar item={item({ askOwnerToPlan: true, startPlanning: true })} />);
    expect(screen.getByText(/want to expand this idea/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ask the product owner/i }));
    await waitFor(() => expect(ask).toHaveBeenCalledWith("OPP-0001"));
  });

  it("offers Continue for a free interview, and takes it", async () => {
    render(<PlanInterviewBar item={item({ takePlanning: true })} />);
    fireEvent.click(screen.getByRole("button", { name: /continue the plan interview/i }));
    await waitFor(() => expect(take).toHaveBeenCalledWith("OPP-0001"));
  });

  it("lets the author who holds it hand it to the product owner", async () => {
    render(<PlanInterviewBar item={item({ releasePlanning: true, workPlan: true })} />);
    fireEvent.click(screen.getByRole("button", { name: /hand over to the product owner/i }));
    await waitFor(() => expect(release).toHaveBeenCalledWith("OPP-0001"));
  });

  it("lets an Owner who holds it simply hand it back", () => {
    render(
      <PlanInterviewBar item={item({ releasePlanning: true, closePlan: true, decline: true })} />,
    );
    expect(screen.getByRole("button", { name: /^hand over$/i })).toBeInTheDocument();
  });

  it("says who is running it, and offers nothing, when someone else holds it", () => {
    render(
      <PlanInterviewBar item={item({}, { planHolder: { id: 3, name: "Asha", as: "author" } })} />,
    );
    expect(screen.getByText(/asha is running the plan interview/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing when there is nothing to do", () => {
    const { container } = render(<PlanInterviewBar item={item({})} />);
    expect(container).toBeEmptyDOMElement();
  });
});
