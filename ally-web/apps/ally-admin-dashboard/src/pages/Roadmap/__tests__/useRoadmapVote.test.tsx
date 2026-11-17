import "@constants";
import React from "react";

import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RoadmapItemDetail } from "@types";

const mockAllocate = vi.fn();

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSetRoadmapAllocationMutation: () => [mockAllocate],
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { roadmapV2API } from "@api";
import { store } from "@store";

import { useRoadmapVote } from "../hooks/useRoadmapVote";

const item = {
  id: "opp-uuid-1",
  code: "OPP-1",
  title: "Streak",
  shownStage: "submitted",
  statusParts: { stage: "submitted", since: null, votes: 4 },
  author: { id: 1, name: "Ravi", role: "idea" },
  votes: 4,
  votedByMe: false,
  starred: false,
  unread: false,
  updatedAt: "",
  stageSince: "",
  summary: {},
  runs: [],
  prs: [],
  releases: [],
  people: [],
  can: { vote: true },
  watchLevel: "none",
} as RoadmapItemDetail;

const seed = () =>
  store.dispatch(roadmapV2API.util.upsertQueryData("getRoadmapItem", "OPP-1", item) as never);

const cached = () => roadmapV2API.endpoints.getRoadmapItem.select("OPP-1")(store.getState()).data;

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Provider store={store}>{children}</Provider>
);

describe("useRoadmapVote", () => {
  afterEach(() => {
    mockAllocate.mockReset();
    store.dispatch(roadmapV2API.util.resetApiState());
  });

  it("moves the idea's votes at once and keeps them when the server agrees", async () => {
    await act(async () => {
      await seed();
    });
    let resolve: (value: unknown) => void = () => undefined;
    mockAllocate.mockReturnValue({
      unwrap: () =>
        new Promise(r => {
          resolve = r;
        }),
    });
    const { result } = renderHook(() => useRoadmapVote("OPP-1"), { wrapper });
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current("opp-uuid-1", 1, 0);
    });
    // Optimistic: before the server answers.
    expect(cached()).toMatchObject({ votes: 5, votedByMe: true });
    await act(async () => {
      resolve({ votes: 1, budget: { available: 9 } });
      await pending;
    });
    expect(mockAllocate).toHaveBeenCalledWith({ opportunityId: "opp-uuid-1", votes: 1 });
    expect(cached()).toMatchObject({ votes: 5, votedByMe: true });
  });

  it("undoes the optimistic vote when the server refuses it", async () => {
    await act(async () => {
      await seed();
    });
    mockAllocate.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message: "No votes left" } }),
    });
    const { result } = renderHook(() => useRoadmapVote("OPP-1"), { wrapper });
    await act(async () => {
      await result.current("opp-uuid-1", 1, 0);
    });
    expect(cached()).toMatchObject({ votes: 4, votedByMe: false });
  });
});
