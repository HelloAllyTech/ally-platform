import React from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { recCard, stateOf } from "./fixtures";

const data = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@api", () => ({
  useGetPmAgentTrackingQuery: () => ({
    data: data.current,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetPmAgentFeedStateQuery: () => ({ data: stateOf() }),
  useRetryPmAgentCardMutation: () => [vi.fn(), {}],
  useDismissPmAgentCardMutation: () => [vi.fn(), {}],
  useFileAnywayPmAgentCardMutation: () => [vi.fn(), {}],
  useRunPmAgentNowMutation: () => [vi.fn(), { isLoading: false }],
  useUpdatePmAgentSettingsMutation: () => [vi.fn(), { isLoading: false }],
}));

import { TrackingView } from "../TrackingView";

describe("TrackingView", () => {
  it("groups cards by where they are on the roadmap, links each to its opportunity, and has no Revert", () => {
    data.current = {
      needsYou: [
        recCard("n", {
          status: "needs_attention",
          needsYou: { reason: "The roadmap refused the filing.", actions: ["retry", "dismiss"] },
        }),
      ],
      inProgress: [
        recCard("p", {
          status: "filed",
          delivery: {
            status: "prioritised",
            prs: [],
            roadmap: {
              opportunityId: "opp-1",
              code: "OPP-0901",
              stage: "prioritised",
              removed: false,
            },
          },
        }),
      ],
      shipped: [recCard("s", { status: "released" })],
      other: [
        recCard("x", {
          status: "roadmap_archived",
          delivery: {
            status: null,
            prs: [],
            roadmap: { opportunityId: "opp-2", code: "OPP-0902", stage: null, removed: true },
          },
        }),
      ],
    };
    render(<TrackingView />);
    expect(screen.getByRole("region", { name: "Needs you" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "On the roadmap" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Released" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Archived and other" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "OPP-0901" })).toHaveAttribute(
      "href",
      "/product-roadmap?opportunity=opp-1",
    );
    expect(screen.getByText(/Prioritised$/, { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("OPP-0902 was removed from the roadmap.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getAllByRole("list", { name: "Roadmap progress" }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/revert|build cost/i)).not.toBeInTheDocument();
  });

  it("shows an empty message when nothing was accepted", () => {
    data.current = { needsYou: [], inProgress: [], shipped: [], other: [] };
    render(<TrackingView />);
    expect(screen.getByText(/Nothing accepted yet/)).toBeInTheDocument();
  });
});
