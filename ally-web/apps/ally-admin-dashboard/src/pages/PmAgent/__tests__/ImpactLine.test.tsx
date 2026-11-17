import React from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { recCard } from "./fixtures";
import { copy } from "../copy";

const data = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@api", () => ({
  useGetPmAgentTrackingQuery: () => ({
    data: data.current,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetPmAgentFeedStateQuery: () => ({ data: undefined }),
  useRetryPmAgentCardMutation: () => [vi.fn(), {}],
  useDismissPmAgentCardMutation: () => [vi.fn(), {}],
  useRunPmAgentNowMutation: () => [vi.fn(), { isLoading: false }],
  useUpdatePmAgentSettingsMutation: () => [vi.fn(), { isLoading: false }],
}));

import { ImpactLine, TrackingView } from "../TrackingView";

const due = new Date(Date.now() + 5 * 86_400_000).toISOString();
const past = new Date(Date.now() - 2 * 86_400_000).toISOString();

describe("ImpactLine", () => {
  it("shows an improved measured read with summary, verdict text and baseline", () => {
    render(
      <ImpactLine
        impact={{
          metricName: "Next-day return",
          direction: "up",
          unit: "percent",
          baseline: 38,
          summary: "Next-day return: 38% to 44% (improved)",
          checks: [
            {
              day: 14,
              status: "measured",
              value: 44,
              readAt: past,
              dueAt: past,
              verdict: "improved",
            },
            { day: 30, status: "pending", dueAt: due },
          ],
        }}
      />,
    );
    expect(screen.getByText("Next-day return: 38% to 44% (improved)")).toBeInTheDocument();
    expect(screen.getByText(/Improved/)).toBeInTheDocument();
    expect(screen.getByText("Baseline 38%")).toBeInTheDocument();
    expect(screen.getByText("+14 d")).toBeInTheDocument();
    expect(screen.getByText("+30 d")).toBeInTheDocument();
    expect(screen.getByText(/Due in 5d/)).toBeInTheDocument();
  });

  it("shows a worse verdict with text and an icon, not colour alone", () => {
    render(
      <ImpactLine
        impact={{
          metricName: "Latency",
          direction: "down",
          checks: [
            { day: 14, status: "measured", value: 5, readAt: past, dueAt: past, verdict: "worse" },
          ],
        }}
      />,
    );
    expect(screen.getByText(/Worse/)).toBeInTheDocument();
    expect(screen.getByText("▼", { exact: false })).toBeInTheDocument();
    // Falls back to the metric name when there is no summary.
    expect(screen.getByText("Latency")).toBeInTheDocument();
  });

  it("explains insufficient data and an unreadable metric", () => {
    render(
      <ImpactLine
        impact={{
          metricName: "M",
          direction: "up",
          checks: [
            { day: 14, status: "insufficient_data", dueAt: past },
            { day: 30, status: "unavailable", dueAt: due },
          ],
        }}
      />,
    );
    expect(screen.getByText(copy.tracking.impact.insufficient)).toBeInTheDocument();
    expect(screen.getByText(copy.tracking.impact.unavailable)).toBeInTheDocument();
  });

  it.each([[undefined], [null]])("says impact is not measurable when impact is %s", impact => {
    render(<ImpactLine impact={impact} />);
    expect(screen.getByText("Impact not measurable")).toBeInTheDocument();
  });

  it("tolerates a summary with no checks array", () => {
    render(<ImpactLine impact={{ metricName: "M", direction: "up" } as never} />);
    expect(screen.getByText("M")).toBeInTheDocument();
  });
});

describe("TrackingView impact", () => {
  it("shows impact on Shipped rows only", () => {
    data.current = {
      needsYou: [],
      inProgress: [recCard("p", { status: "building" })],
      shipped: [
        recCard("s1", {
          status: "released",
          delivery: {
            status: "released",
            prs: [],
            impact: {
              metricName: "M",
              direction: "up",
              summary: "M: 1 to 2 (improved)",
              checks: [],
            },
          },
        }),
        recCard("s2", { status: "released" }),
      ],
      other: [],
    };
    render(<TrackingView />);
    expect(screen.getByText("M: 1 to 2 (improved)")).toBeInTheDocument();
    expect(screen.getAllByText("Impact not measurable")).toHaveLength(1);
  });
});
