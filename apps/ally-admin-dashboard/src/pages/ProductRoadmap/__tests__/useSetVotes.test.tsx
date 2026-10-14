import "@constants";

import React from "react";

import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RoadmapOpportunity } from "@types";

const setAllocation = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// Partial: productRoadmapAPI and the store stay real, so the patches below land in a real cache.
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useSetRoadmapAllocationMutation: () => [
    (args: unknown) => ({ unwrap: () => setAllocation(args) }),
    { isLoading: false },
  ],
}));

import { productRoadmapAPI } from "@api";
import { store } from "@store";

import { useSetVotes } from "../useSetVotes";

const OPPORTUNITY_ID = "opp-1";

const seed = async () => {
  await store.dispatch(
    productRoadmapAPI.util.upsertQueryData("getRoadmapOpportunity", OPPORTUNITY_ID, {
      id: OPPORTUNITY_ID,
      priorityScore: 10,
      myVotes: 2,
    } as RoadmapOpportunity),
  );
  await store.dispatch(
    productRoadmapAPI.util.upsertQueryData("getRoadmapVoteBudget", undefined, { available: 5 }),
  );
};

const detail = () =>
  productRoadmapAPI.endpoints.getRoadmapOpportunity.select(OPPORTUNITY_ID)(store.getState()).data;
const budget = () =>
  productRoadmapAPI.endpoints.getRoadmapVoteBudget.select()(store.getState()).data;

const renderSetVotes = () =>
  renderHook(() => useSetVotes({ kind: "detail" }), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    ),
  }).result.current;

describe("useSetVotes — the drawer's detail target", () => {
  beforeEach(async () => {
    setAllocation.mockReset();
    await seed();
  });

  it("reconciles the drawer's own cache entry and the budget from the server's answer", async () => {
    // The server's total differs from the optimistic +1: someone else voted in between.
    setAllocation.mockResolvedValue({
      opportunityId: OPPORTUNITY_ID,
      votes: 3,
      priorityScore: 14,
      budget: { available: 4 },
    });
    const vote = renderSetVotes();

    await act(() => vote(OPPORTUNITY_ID, 3, 2));

    expect(setAllocation).toHaveBeenCalledWith({ opportunityId: OPPORTUNITY_ID, votes: 3 });
    expect(detail()).toMatchObject({ myVotes: 3, priorityScore: 14 });
    expect(budget()).toEqual({ available: 4 });
  });

  it("rolls the optimistic patch back when the server refuses", async () => {
    setAllocation.mockRejectedValue({ status: 409, data: { message: "No longer open." } });
    const vote = renderSetVotes();

    await act(() => vote(OPPORTUNITY_ID, 3, 2));

    expect(detail()).toMatchObject({ myVotes: 2, priorityScore: 10 });
    expect(budget()).toEqual({ available: 5 });
  });
});
