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
  useRunPmAgentNowMutation: () => [vi.fn(), { isLoading: false }],
  useUpdatePmAgentSettingsMutation: () => [vi.fn(), { isLoading: false }],
}));

import { TrackingView } from "../TrackingView";

describe("TrackingView", () => {
  it("groups cards, shows the stepper, PR links and cost, and has no Revert", () => {
    data.current = {
      needsYou: [
        recCard("n", {
          status: "failed",
          needsYou: { reason: "Build failed", actions: ["retry"] },
        }),
      ],
      inProgress: [
        recCard("p", {
          status: "pr_open",
          delivery: {
            status: "pr_open",
            prs: [{ url: "https://github.com/x/y/pull/1" }],
            costUsd: 1.5,
          },
        }),
      ],
      shipped: [recCard("s", { status: "released" })],
      other: [recCard("h", { status: "handed_off" })],
    };
    render(<TrackingView />);
    expect(screen.getByRole("region", { name: "Needs you" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "In progress" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Shipped" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Handed off and other" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PR 1" })).toHaveAttribute(
      "href",
      "https://github.com/x/y/pull/1",
    );
    expect(screen.getByText("Build cost $1.50")).toBeInTheDocument();
    expect(screen.getAllByRole("list", { name: "Build progress" }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/revert/i)).not.toBeInTheDocument();
  });

  it("shows an empty message when nothing was accepted", () => {
    data.current = { needsYou: [], inProgress: [], shipped: [], other: [] };
    render(<TrackingView />);
    expect(screen.getByText(/Nothing accepted yet/)).toBeInTheDocument();
  });
});
